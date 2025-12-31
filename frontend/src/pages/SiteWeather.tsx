import React, { useEffect, useMemo, useState } from "react";

interface WeatherData {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  humidity: number;
  pressure: number;
  wind_speed: number;
  wind_deg: number;
  description: string;
  icon: string;
  sunrise: number;
  sunset: number;
  visibility: number;
  timezone: number;
  name: string;
}

const windDirection = (deg: number): string => {
  const directions = ["شمال","شمال شرق","شرق","جنوب شرق","جنوب","جنوب غرب","غرب","شمال غرب"];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
};

const formatTime = (unix: number, tzOffsetSec: number) => {
  const d = new Date((unix + tzOffsetSec) * 1000);
  return d.toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
};

type WeatherProps = {
  defaultCity?: string;
  apiKey?: string;
};

const Weather: React.FC<WeatherProps> = ({
  defaultCity = "Kermanshah",
  apiKey = "b434f133091ecc817e166492f7883550",
}) => {
  const [cityInput, setCityInput] = useState<string>(() => {
    return localStorage.getItem("weather_city") || defaultCity;
  });
  const [city, setCity] = useState<string>(cityInput);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("weather_city", city);
  }, [city]);

  const url = useMemo(
    () =>
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
        city
      )}&appid=${apiKey}&units=metric&lang=fa`,
    [city, apiKey]
  );

  useEffect(() => {
    let abort = false;
    const fetchWeather = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) throw new Error("شهر پیدا نشد");
          throw new Error("خطا در دریافت داده‌های آب‌وهوا");
        }
        const data = await res.json();
        if (abort) return;

        const wd: WeatherData = {
          temp: data.main.temp,
          feels_like: data.main.feels_like,
          temp_min: data.main.temp_min,
          temp_max: data.main.temp_max,
          humidity: data.main.humidity,
          pressure: data.main.pressure,
          wind_speed: data.wind.speed,
          wind_deg: data.wind.deg,
          description: data.weather?.[0]?.description ?? "",
          icon: `https://openweathermap.org/img/wn/${data.weather?.[0]?.icon}@2x.png`,
          sunrise: data.sys.sunrise,
          sunset: data.sys.sunset,
          visibility: data.visibility,
          timezone: data.timezone,
          name: data.name,
        };
        setWeather(wd);
      } catch (e) {
        setWeather(null);
        setError(e instanceof Error ? e.message : "خطایی رخ داد");
      } finally {
        if (!abort) setLoading(false);
      }
    };
    fetchWeather();
    return () => {
      abort = true;
    };
  }, [url]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = cityInput.trim();
    if (!val) return;
    setCity(val);
  };

  return (
    <div dir="rtl" className="max-w-md mx-auto">
      {/* جستجوی شهر - رنگی و هم‌تم با کارت */}
      <form onSubmit={onSubmit} className="mb-3">
        <div className="p-[2px] rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 shadow-md">
          <div className="flex items-stretch gap-2 p-1.5 bg-gradient-to-r from-sky-600/70 to-indigo-700/70 rounded-2xl backdrop-blur">
            <input
              type="text"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder="نام شهر (مثلاً: Tehran یا Kermanshah)"
              className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/80
                         bg-white/10 focus:bg-white/15 outline-none
                         border border-white/10 focus:border-white/30"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl text-sm font-semibold
                         bg-white text-sky-700 hover:bg-white/90 transition-colors
                         shadow"
            >
              جستجو
            </button>
          </div>
        </div>
      </form>

      {/* کارت آب‌وهوا */}
      <div className="bg-gradient-to-tr from-blue-600 to-indigo-800 rounded-xl shadow-lg p-5 text-white">
        {loading && (
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-1/3 bg-white/20 rounded" />
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 bg-white/20 rounded-lg" />
              <div className="h-10 w-20 bg-white/20 rounded" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 bg-white/15 rounded" />
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="text-center text-red-200">
            خطا: {error}
            <div className="mt-2 text-white/80 text-xs">
              اسم شهر را به انگلیسی هم امتحان کن (مثلاً Mashhad).
            </div>
          </div>
        )}

        {!loading && !error && weather && (
          <>
            <h2 className="text-xl font-bold mb-3 text-center">
              آب و هوای {weather.name || city}
            </h2>

            <div className="flex items-center justify-center mb-3">
              <img
                src={weather.icon}
                alt={weather.description}
                className="w-16 h-16"
              />
              <div className="text-4xl font-extrabold ml-3">
                {Math.round(weather.temp)}°C
              </div>
            </div>

            <p className="text-center text-base mb-4 capitalize opacity-95">
              {weather.description}
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><strong>کمینه/بیشینه:</strong> {Math.round(weather.temp_min)}° / {Math.round(weather.temp_max)}°</div>
              <div><strong>دمای حس‌شده:</strong> {Math.round(weather.feels_like)}°C</div>
              <div><strong>رطوبت:</strong> {weather.humidity}%</div>
              <div><strong>فشار:</strong> {weather.pressure} hPa</div>
              <div><strong>سرعت باد:</strong> {weather.wind_speed} m/s</div>
              <div><strong>جهت باد:</strong> {windDirection(weather.wind_deg)}</div>
              <div><strong>طلوع آفتاب:</strong> {formatTime(weather.sunrise, weather.timezone)}</div>
              <div><strong>غروب آفتاب:</strong> {formatTime(weather.sunset, weather.timezone)}</div>
              <div><strong>دید افقی:</strong> {(weather.visibility / 1000).toFixed(1)} km</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Weather;
