import ApiGeoJsonLayer from "../ApiGeoJsonLayer";

const color = (v: number) =>
  v >= 0.8 ? "#b30000" :
  v >= 0.1 ? "#e34a33" :
  v >= 0.03 ? "#fc8d59" :
  v >= 0.01 ? "#fdbb84" :
             "#fdd49e";

export default function QuakeLayer() {
  return (
    <ApiGeoJsonLayer
      url="http://127.0.0.1:8000/api/quake-risk"  // ← دیگه /file نیست
      styleFn={(f) => {
        const v = Number(f?.properties?.risk_quake ?? 0);
        return { fillColor: color(v), color: "#333", weight: 0.8, fillOpacity: 0.7 };
      }}
      popupFn={(f) =>
        `<b>Earthquake risk:</b> ${Number(f?.properties?.risk_quake ?? 0).toFixed(2)}`
      }
      fitOnLoad
    />
  );
}
