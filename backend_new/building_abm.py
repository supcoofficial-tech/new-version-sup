# -*- coding: utf-8 -*-
"""
building_abm.py
نسخهٔ بازنویسی‌شده بر اساس قوانین کاربر (نوا).
- فقط از کاربری‌های پایه 1..9 استفاده می‌شود.
- Demolation == 0 => ممنوعیت تخریب و ممنوعیت توسعه عمودی (فقط Renovation مجاز)
- توسعه عمودی: Landuse == 1 (مسکونی) و ساخت جدید روی Landuse == 5 (بایر)
- افزایش طبقات: حداکثر تا 3 طبقه اضافه (در یک گام می‌توان 1..3 اضافه کرد)
- تغییر کاربری: تنها برای پالیگون‌هایی که initial_landuse == 1 امکان‌پذیر است،
  و مقصدها فقط در {2,6,8,3} هستند؛ احتمال‌ها طوری است که 2،6،8 بیشتر از 3 هستند.
- تراکم همسایگی و فشار جمعیت و اثر قیمت زمین مدل شده‌اند (ساده و پارامتریک).
- خروجی: GeoJSON با فیلدهای initial_landuse, final_landuse, last_action, added_floors, p_* و لاگ CSV.
"""
from __future__ import annotations
import os
import argparse
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import math
import pandas as pd
import geopandas as gpd
import numpy as np



# ----------------------
# پارامترهای پیش‌فرض (قابل تنظیم از CLI)
# ----------------------
PROTECTED_LANDUSE = {4, 9, 3, 6, 7}   # این‌ها نباید تغییر کاربری پیدا کنند (مبنای اولیه)
CHANGE_TARGETS = [2, 6, 8, 3]         # مقصدهای مجاز از Landuse==1
# احتمال‌ها متناظر با ترتیب بالا (جمع ~1.0)
CHANGE_WEIGHTS = [0.35, 0.30, 0.25, 0.10]

MAX_ADDITIONAL_FLOORS = 3    # حداکثر افزایش طبقه در یک اقدام
BASE_VERTICAL_PROB = 0.15    # احتمال پایه توسعه عمودی
POP_PRESSURE_EFFECT = 0.6    # هر واحد pop_index (نسبی) این ضریب رو اعمال می‌کنه
PRICE_INCREASE_PER_POP = 0.08  # افزایش نسبی قیمت به ازای افزایش pop_index
PRICE_DECREASE_AFTER_DEVELOP = 0.12  # کاهش نسبی قیمت پس از توسعه (متقارن با توضیحات)
PRICE_THRESHOLD_VERTICAL = 12_000_000.0  # آستانه قیمت برای اینکه توسعه عمودی جذاب باشه

NEIGHBOR_RADIUS = 30.0  # متر، شعاع همسایگی برای محاسبه تراکم/ارتفاع میانگین

random.seed(42)  # برای تکرارپذیری نتایج تستی؛ در صورت نیاز می‌تونی حذفش کنی

# ----------------------
# داده‌های کمکی
# ----------------------
def sample_change_target() -> int:
    """نمونه‌گیری مقصد تغییر کاربری برای Landuse==1 با وزن‌های مشخص"""
    return int(random.choices(CHANGE_TARGETS, weights=CHANGE_WEIGHTS, k=1)[0])

# ----------------------
# Agent
# ----------------------
@dataclass
class BuildingAgent:
    idx: Any
    geometry: Any
    props: Dict[str, Any]

    # حفظ کاربری اولیه و جاری
    initial_landuse: Optional[int] = None
    final_landuse: Optional[int] = None

    # وضعیت فیزیکی
    floors: int = 1
    height: float = 3.0

    # پرچم تخریب (مقدار از ستون Demolation)
    demolition_flag: Optional[int] = None

    # سایر ویژگی‌ها
    condition: float = 0.8
    redevelopment_pressure: float = 0.15
    land_price: float = 20_000_000.0
    occupied: int = 1  # 1 = پر، 0 = خالی

    # خروجی‌ها / آمار
    last_action: str = "NoChange"
    added_floors: int = 0

    # برای ردیابی تاریخچه
    history: List[Dict[str, Any]] = field(default_factory=list)

    def to_record(self, t:int, pop_index: float) -> Dict[str,Any]:
        rec = {
            "index": self.idx,
            "time": t,
            "initial_landuse": int(self.initial_landuse) if self.initial_landuse is not None else None,
            "final_landuse": int(self.final_landuse) if self.final_landuse is not None else None,
            "floors": int(self.floors) if self.floors is not None else None,
            "height": float(self.height) if self.height is not None else None,
            "demo_flag": int(self.demolition_flag) if self.demolition_flag is not None else None,
            "condition": float(self.condition),
            "redevelopment_pressure": float(self.redevelopment_pressure),
            "land_price": float(self.land_price),
            "last_action": self.last_action,
            "added_floors": int(self.added_floors),
            "pop_index": float(pop_index),
        }
        return rec

# ----------------------
# Decision model ساده (پایه‌ای)
# ----------------------
class RuleBasedDecisionModel:
    def __init__(self, price_threshold: float = PRICE_THRESHOLD_VERTICAL, base_vert_prob: float = BASE_VERTICAL_PROB):
        self.price_threshold = price_threshold
        self.base_vert_prob = base_vert_prob

    def predict_probs(self, feat: Dict[str, Any]) -> Dict[str, float]:
        """
        ورودی: feat شامل age, redevelopment_pressure, accessibility_score, land_price, FAR, condition
        خروجی: دیکشنری احتمالات برای demolition، vertical، renovation، change_use
        """
        age = float(feat.get("age", 30.0))
        rp = float(feat.get("redevelopment_pressure", 0.15))
        acc = float(feat.get("accessibility_score", 0.5))
        price = float(feat.get("land_price", 20_000_000.0))
        far = float(feat.get("FAR", 1.0))
        cond = float(feat.get("condition", 0.8))

        p_dem = 0.0
        p_vert = 0.0
        p_ren = 0.0
        p_ch = 0.0

        # تخریب: سن بالا + فشار بازآفرینی
        if (age >= 25.0) and (rp >= 0.25):
            p_dem = min(0.85, 0.3 + 0.6 * (rp))

        # توسعه عمودی: قیمت بالا و FAR کمتر از سقف (مثلاً FAR فرضی 4)
        if (price >= self.price_threshold) and (far < 4.0):
            p_vert = min(0.95, self.base_vert_prob + 0.6 * acc)

        # نوسازی: وضعیت نامناسب ساختمان
        if cond < 0.6:
            p_ren = min(0.85, 0.35 + 0.4 * (0.6 - cond))

        # تغییر کاربری: فشار متوسط + دسترسی خوب
        if (rp >= 0.15) and (acc >= 0.55):
            p_ch = min(0.6, 0.2 + 0.5 * rp)

        return {
            "p_demolition": float(p_dem),
            "p_vertical": float(p_vert),
            "p_renovation": float(p_ren),
            "p_change_use": float(p_ch),
        }

# ----------------------
# Simulator
# ----------------------
class BuildingABMSimulator:
    def __init__(self, gdf: gpd.GeoDataFrame, model: RuleBasedDecisionModel,
                 pop_index: float = 1.0, undeveloped_gdf: Optional[gpd.GeoDataFrame] = None):
        self.gdf = gdf.copy()
        self.model = model
        self.pop_index = float(pop_index)  # 1.0 baseline
        self.undeveloped = undeveloped_gdf  # optional layer of undeveloped parcels (if provided)
        self.agents: Dict[Any, BuildingAgent] = {}
        self.log: List[Dict[str, Any]] = []
        self.t = 0
        self.current_price_index = 1.0  # relative price index
        self._build_agents()

    def _build_agents(self):
        for idx, row in self.gdf.iterrows():
            geom = row.geometry
            props = row.to_dict()

            # initial landuse: ensure int in 1..9 (fallback to 1 if missing)
            try:
                lu = int(row["Landuse"]) if "Landuse" in row.index and pd.notna(row["Landuse"]) else int(row.get("landuse", 1))
            except Exception:
                lu = 1
            if lu < 1 or lu > 9:
                lu = 1

            floors = int(row["floors"]) if "floors" in row.index and pd.notna(row["floors"]) else int(row.get("Floors_Num", 1) or 1)
            demo_flag = int(row["Demolation"]) if "Demolation" in row.index and pd.notna(row["Demolation"]) else None
            condition = float(row.get("condition") if pd.notna(row.get("condition")) else row.get("Condition", 0.8) or 0.8)
            rp = float(row.get("redevelopment_pressure", 0.15) or 0.15)
            price = float(row.get("land_price", 20_000_000.0) or 20_000_000.0)
            occupied = int(row.get("occupied", 1) if pd.notna(row.get("occupied", 1)) else 1)

            ag = BuildingAgent(
                idx=idx,
                geometry=geom,
                props=props,
                initial_landuse=lu,
                final_landuse=lu,
                floors=floors,
                height=float(row.get("height", floors * 3.0 if floors else 3.0)),
                demolition_flag=demo_flag,
                condition=condition,
                redevelopment_pressure=rp,
                land_price=price,
                occupied=occupied,
            )
            # also copy initial landuse into props for traceability
            ag.props["initial_landuse"] = ag.initial_landuse
            self.agents[idx] = ag

    def _neighbor_stats(self, radius: float = NEIGHBOR_RADIUS):
        """محاسبهٔ آمار همسایگی: تعداد همسایه‌ها، تعداد خالی‌ها، میانگین ارتفاع"""
        g = self.gdf
        stats = {}
        for idx, ag in self.agents.items():
            try:
                buf = ag.geometry.buffer(radius)
                neigh = g[g.geometry.intersects(buf) & (g.index != idx)]
                n_total = len(neigh)
                if n_total == 0:
                    stats[idx] = {"n_neighbors": 0, "neighbor_empty": 0, "avg_height": 0.0}
                else:
                    neighbor_empty = int((neigh.get("occupied", 1) == 0).sum()) if "occupied" in neigh.columns else 0
                    # avg height: use 'height' if exists else 'floors'
                    if "height" in neigh.columns and neigh["height"].notna().any():
                        avg_h = float(neigh["height"].fillna(neigh.get("floors", 1)).astype(float).mean())
                    else:
                        avg_h = float(neigh.get("floors", 1).astype(float).mean()) if len(neigh) > 0 else 0.0
                    stats[idx] = {"n_neighbors": n_total, "neighbor_empty": neighbor_empty, "avg_height": avg_h}
            except Exception:
                stats[idx] = {"n_neighbors": 0, "neighbor_empty": 0, "avg_height": 0.0}
        return stats

    def _apply_price_dynamics_before(self):
        """update price index based on pop_index (demand effect)"""
        # simple: price_index increases multiplicatively with pop_index delta
        # if pop_index == 1.0 baseline -> no change
        self.current_price_index *= (1.0 + (self.pop_index - 1.0) * PRICE_INCREASE_PER_POP)

    def _apply_price_dynamics_after_develop(self, n_developments: int):
        """after developments, price partially relaxes"""
        if n_developments > 0:
            # simple linear relaxation proportional to number of developments
            decay = PRICE_DECREASE_AFTER_DEVELOP * min(1.0, n_developments / 50.0)
            self.current_price_index *= (1.0 - decay)

    def step(self):
        """یک گام شبیه‌سازی"""
        neighbor_info = self._neighbor_stats()
        # update price before decisions
        self._apply_price_dynamics_before()

        n_developments = 0

        for idx, ag in list(self.agents.items()):
            # build feature vector
            age = 30.0
            if "year_built" in ag.props and pd.notna(ag.props.get("year_built")):
                try:
                    age = max(0.0, 2025 - int(ag.props.get("year_built")))
                except Exception:
                    age = 30.0
            feat = {
                "age": age,
                "redevelopment_pressure": float(ag.redevelopment_pressure or 0.0),
                "accessibility_score": float(ag.props.get("accessibility_score", 0.5) or 0.5),
                "land_price": float(ag.land_price or 20_000_000.0) * float(self.current_price_index),
                "FAR": float(ag.floors or 1.0),
                "condition": float(ag.condition if ag.condition is not None else 0.8),
            }

            probs = self.model.predict_probs(feat)

            # adjust vertical probability by population pressure (higher pop -> more vertical)
            p_vert = probs.get("p_vertical", 0.0)
            # apply pop effect multiplicatively
            p_vert = min(1.0, p_vert * (1.0 + (self.pop_index - 1.0) * POP_PRESSURE_EFFECT))

            # neighbor adjustments: if many empties reduce vertical incentive; if surrounding avg height > current -> increase
            neigh = neighbor_info.get(idx, {"neighbor_empty": 0, "avg_height": 0.0})
            if neigh.get("neighbor_empty", 0) > max(1, neigh.get("n_neighbors", 0) * 0.5):
                p_vert *= 0.85
            if neigh.get("avg_height", 0.0) > (ag.floors or 0):
                p_vert *= 1.15

            # Hard constraints:
            chosen_action = "NoChange"

            # If explicit demolition flag == 1 -> allow demolition
            if ag.demolition_flag == 1:
                chosen_action = "Demolition"
            # If demolition flag == 0 -> forbid demolition and forbid vertical development, only renovation or maybe change use
            elif ag.demolition_flag == 0:
                # only renovation or change use (but change use only if initial_landuse == 1)
                if probs.get("p_renovation", 0.0) >= 0.35:
                    chosen_action = "Renovation"
                else:
                    if (ag.initial_landuse == 1) and (random.random() < probs.get("p_change_use", 0.12)):
                        # but ensure initial_landuse is not protected (we only check initial)
                        if ag.initial_landuse not in PROTECTED_LANDUSE:
                            target = sample_change_target()
                            ag.props["proposed_landuse"] = target
                            chosen_action = f"ChangeUse_to_{target}"
                        else:
                            chosen_action = "NoChange"
                    else:
                        chosen_action = "NoChange"
            else:
                # default decision flow when no explicit demolition forbids
                # Priority: demolition (high p_dem) > vertical/new construction > change use > renovation
                if probs.get("p_demolition", 0.0) >= 0.6:
                    chosen_action = "Demolition"
                else:
                    # Vertical expansion eligible if current (or initial) landuse == 1
                    # and demolition flag not 0 (we're in else) and ag.final_landuse==1
                    is_residential_current = (ag.final_landuse == 1)
                    is_empty_parcel = (ag.final_landuse == 5)
                    # prioritize vertical on residential or build on empty
                    if is_residential_current and (random.random() < p_vert):
                        # add floors 1..MAX_ADDITIONAL_FLOORS but ensure not exceeding +3 per spec
                        add = random.randint(1, MAX_ADDITIONAL_FLOORS)
                        ag.added_floors = min(add, MAX_ADDITIONAL_FLOORS)
                        chosen_action = "VerticalExpansion"
                    elif is_empty_parcel and (random.random() < p_vert):
                        # new construction on empty land
                        add = random.randint(1, min(2, MAX_ADDITIONAL_FLOORS))
                        ag.added_floors = add
                        chosen_action = "NewConstruction"
                    else:
                        # change use: only if initial_landuse == 1 and initial not protected
                        if (ag.initial_landuse == 1) and (ag.initial_landuse not in PROTECTED_LANDUSE) and (random.random() < probs.get("p_change_use", 0.0)):
                            target = sample_change_target()
                            ag.props["proposed_landuse"] = int(target)
                            chosen_action = f"ChangeUse_to_{target}"
                        else:
                            # renovation if condition low
                            if probs.get("p_renovation", 0.0) >= 0.35:
                                chosen_action = "Renovation"
                            else:
                                chosen_action = "NoChange"

            # Apply chosen action but respect that if initial_landuse is protected (one of PROTECTED_LANDUSE),
            # no final_landuse change must occur (we can still demolish or renovate but we avoid changing final_landuse)
            applied = self._apply_action(ag, chosen_action)
            if applied in ("VerticalExpansion", "NewConstruction"):
                n_developments += 1

            ag.history.append({"t": self.t, "action": chosen_action})
            self.log.append({
                "time": self.t,
                "index": ag.idx,
                "action": chosen_action,
                "initial_landuse": ag.initial_landuse,
                "final_landuse": ag.final_landuse,
                "added_floors": ag.added_floors,
                "p_demolition": float(probs.get("p_demolition", 0.0)),
                "p_vertical": float(p_vert),
                "p_renovation": float(probs.get("p_renovation", 0.0)),
                "p_change_use": float(probs.get("p_change_use", 0.0)),
            })

        # After iterating agents, update price dynamics due to developments
        self._apply_price_dynamics_after_develop(n_developments)

        # increment time
        self.t += 1

    def _apply_action(self, ag: BuildingAgent, action: str) -> str:
        """اعمال اکشن روی ایجنت؛ به‌طور امن final_landuse را فقط زمانی تغییر می‌دهد که initial مجاز باشد"""
        is_protected_initial = (ag.initial_landuse in PROTECTED_LANDUSE)

        if action == "NoChange":
            ag.last_action = "NoChange"
            ag.added_floors = 0
            return "NoChange"

        if action == "Demolition":
            # اگر Demolation==0 بود قبلاً فیلتر شد؛ اینجا تخریب واقعی انجام شود
            ag.floors = 0
            ag.height = 0.0
            ag.condition = 0.2
            ag.last_action = "Demolition"
            ag.added_floors = 0
            # در حالت تخریب، اگر اولیه محافظت‌شده نباشد می‌توان landuse را به بایر (5) تبدیل کرد
            if not is_protected_initial:
                ag.final_landuse = 5
                ag.props["Landuse"] = int(ag.final_landuse)
            return "Demolition"

        if action == "VerticalExpansion":
            inc = int(ag.added_floors or 1)
            ag.floors = int(ag.floors or 0) + inc
            ag.height = (ag.height or 3.0) + 3.0 * inc
            ag.condition = min(1.0, ag.condition + 0.1)
            ag.last_action = "VerticalExpansion"
            # final_landuse stays unchanged (vertical only for residential)
            return "VerticalExpansion"

        if action == "NewConstruction":
            inc = int(ag.added_floors or 1)
            ag.floors = int(ag.floors or 0) + inc
            ag.height = (ag.height or 3.0) + 3.0 * inc
            ag.condition = 0.9
            ag.last_action = "NewConstruction"
            # new construction -> residential (1) only if initial not protected (but initial parcel==5 typically)
            if not is_protected_initial:
                ag.final_landuse = 1
                ag.props["Landuse"] = int(ag.final_landuse)
            return "NewConstruction"

        if action.startswith("ChangeUse"):
            # فقط وقتی که initial_landuse == 1 و initial not protected مجاز است
            proposed = ag.props.get("proposed_landuse")
            if (ag.initial_landuse == 1) and (not is_protected_initial) and (proposed is not None):
                # ensure proposed is one of allowed targets and within 1..9
                try:
                    proposed_int = int(proposed)
                except Exception:
                    return "NoChange"
                if proposed_int in CHANGE_TARGETS:
                    ag.final_landuse = proposed_int
                    ag.props["Landuse"] = int(ag.final_landuse)
                    ag.last_action = f"ChangeUse_to_{proposed_int}"
                    return f"ChangeUse_to_{proposed_int}"
            # blocked by protection or invalid -> no change
            ag.last_action = "NoChange"
            return "NoChange"

        if action == "Renovation" or action == "renew":
            ag.condition = min(1.0, ag.condition + 0.25)
            ag.last_action = "Renovation"
            ag.added_floors = 0
            return "Renovation"

        # default fallback
        ag.last_action = "NoChange"
        return "NoChange"

    def run(self, steps: int = 1):
        for _ in range(int(steps)):
            self.step()

    def export_geojson(self, out_path: str = "outputs/buildings_out.geojson"):
        """ساخت GeoDataFrame خروجی و نوشتن آن"""
        records = []
        geoms = []
        for idx, ag in self.agents.items():
            rec = ag.to_record(self.t, self.pop_index)
            # ضمیمه کردن بعضی از props اصلی برای ردیابی (بدون geometry)
            for k, v in ag.props.items():
                if k == "geometry":
                    continue
                if k not in rec:
                    rec[k] = v
            records.append(rec)
            geoms.append(ag.geometry)

        df = pd.DataFrame(records)
        # سعی می‌کنیم ایندکس خروجی با ایندکس اصلی هماهنگ باشد
        try:
            df.index = list(self.agents.keys())
        except Exception:
            pass

        out_gdf = gpd.GeoDataFrame(df, geometry=geoms, crs=self.gdf.crs)
        # ensure outputs folder
        out_dir = os.path.dirname(out_path) or "."
        os.makedirs(out_dir, exist_ok=True)
        out_gdf.to_file(out_path, driver="GeoJSON")
        print(f"[INFO] Wrote {len(out_gdf)} features to {out_path}")
        return out_path

    def export_log(self, out_csv: str = "outputs/abm_log.csv"):
        os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)
        pd.DataFrame(self.log).to_csv(out_csv, index=False)
        print(f"[INFO] Wrote log with {len(self.log)} rows to {out_csv}")
        return out_csv

# ----------------------
# CLI و اجرای اصلی
# ----------------------
def parse_args():
    ap = argparse.ArgumentParser(description="Building ABM - rules per user (Nava)")
    ap.add_argument("input_geojson", help="path to buildings GeoJSON (exploded)")
    ap.add_argument("--steps", type=int, default=10, help="number of simulation steps")
    ap.add_argument("--pop_index", type=float, default=1.0, help="initial population pressure index (1.0 baseline)")
    ap.add_argument("--undeveloped", type=str, default=None, help="optional path to undeveloped parcels GeoJSON")
    ap.add_argument("--out_geojson", default="outputs/buildings_out.geojson", help="output GeoJSON path")
    ap.add_argument("--out_log", default="outputs/abm_log.csv", help="output CSV log path")
    return ap.parse_args()

def main():
    args = parse_args()

    if not os.path.exists(args.input_geojson):
        print(f"[ERROR] input file not found: {args.input_geojson}")
        return

    print("[INFO] Loading:", args.input_geojson)
    gdf = gpd.read_file(args.input_geojson)
    print(f"[INFO] Loaded {len(gdf)} features. CRS={gdf.crs}")

    undeveloped_gdf = None
    if args.undeveloped:
        if os.path.exists(args.undeveloped):
            undeveloped_gdf = gpd.read_file(args.undeveloped)
            print(f"[INFO] Loaded undeveloped layer: {len(undeveloped_gdf)} features")
        else:
            print(f"[WARN] undeveloped path provided but file not found: {args.undeveloped}")

    model = RuleBasedDecisionModel()
    sim = BuildingABMSimulator(gdf, model, pop_index=args.pop_index, undeveloped_gdf=undeveloped_gdf)

    print(f"[INFO] Running simulation for {args.steps} steps ...")
    sim.run(steps=args.steps)

    print("[INFO] Exporting outputs ...")
    sim.export_geojson(args.out_geojson)
    sim.export_log(args.out_log)
    print("[INFO] Done.")

if __name__ == "__main__":
    main()
