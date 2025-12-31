import { Link } from "react-router-dom";
import {
  ShieldCheck, Footprints,  Gauge, Building2, Users,
  Bell, Search, HelpCircle,  CloudSun,  CalendarDays, Sun,
  Bus,
  TreePine,
  Mountain,
  Bolt,
  Landmark,Home
} from "lucide-react";

type Card = { title: string; link: string; color: string; icon: JSX.Element };

const GlassPanel: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <section className="rounded-3xl bg-white/60 backdrop-blur-md border border-gray-200/70 shadow-lg p-6 sm:p-8">
    <h2 className="text-xl font-extrabold text-gray-800">{title}</h2>
    <p className="text-sm text-gray-500 mt-1 mb-6">{subtitle}</p>
    {children}
  </section>
);

const DashCard: React.FC<{ card: Card }> = ({ card }) => (
  <Link
    to={card.link}
    className={`group rounded-2xl p-5 text-center border border-white/40 shadow-md bg-gradient-to-br ${card.color} backdrop-blur-md transition-all hover:shadow-xl`}
  >
    <div className="flex justify-center mb-3 text-gray-700 group-hover:scale-110 transition">
      {card.icon}
    </div>
    <div className="text-[13px] font-semibold text-gray-800 leading-5">{card.title}</div>
  </Link>
);

export default function Dashboard() {
  // کارت‌های پنل مدیریت

const adminCards: Card[] = [
  {
    title: "(2D) توسعه شهری",
    link: "/urban-dev",
    color: "from-cyan-100/80 to-emerald-100/70",
    icon: <Building2 size={28} />, // 🏙️ توسعه شهری
  },
  {
    title: "(2D) اکولوژی",
    link: "/resilience",
    color: "from-green-100/80 to-lime-100/70",
    icon: <TreePine size={28} />, // 🌲 اکولوژی و محیط زیست
  },
  {
    title: "(3D) منظر شهری",
    link: "/unity-sim",
    color: "from-violet-100/80 to-purple-100/70",
    icon: <Mountain size={28} />, // 🏔️ منظر شهری سه‌بعدی
  },
  {
    title: "(2D) حمل و نقل",
    link: "/transport",
    color: "from-sky-100/80 to-indigo-100/70",
    icon: <Bus size={28} />, // 🚌 حمل‌ونقل شهری
  },
  {
    title: "انرژی",
    link: "/admin/energy",
    color: "from-amber-100/80 to-orange-100/70",
    icon: <Bolt size={28} />, // ⚡ انرژی
  },
  {
    title: "گردشگری",
    link: "/admin/tourism",
    color: "from-rose-100/80 to-pink-100/70",
    icon: <Landmark size={28} />, // 🏛️ جاذبه‌ها و گردشگری
  },
];
  // کارت‌های پنل شهروند
  const citizenCards: Card[] = [
  {
    title: "آب و هوا",
    link: "/site-weather",
    color: "from-cyan-100/80 to-sky-100/70",
    icon: <Sun size={28} />, // ☀️ نمایش آب و هوا
  },
  {
    title: "مشارکت",
    link: "/citizen/participation",
    color: "from-pink-100/80 to-rose-100/70",
    icon: <Users size={28} />, // 👥 برای مشارکت مردمی
  },
  {
    title: "رویدادها",
    link: "/citizen/events",
    color: "from-purple-100/80 to-violet-100/70",
    icon: <CalendarDays size={28} />, // 📅 برای رویدادها
  },
  {
    title: "حمل و نقل",
    link: "/citizen/transport",
    color: "from-emerald-100/80 to-teal-100/70",
    icon: <Bus size={28} />, // 🚌 برای حمل‌ونقل عمومی
  },
  {
  title: "واحد همسایگی",
  link: "/citizen/neighborhood",
  color: "from-emerald-100/80 to-teal-100/70",
  icon: <Home size={28} />, // 🏠 نماد واحد همسایگی
},
    {
    title: "تفریحی و گردشگری" ,
    link: "/admin/tourism",
    color: "from-rose-100/80 to-pink-100/70",
    icon: <Landmark size={28} />, // 🏛️ جاذبه‌ها و گردشگری
  },
];

  return (
    <div dir="rtl" className="min-h-screen bg-pink-50">
      {/* هدر با لوگو */}
      <header className="sticky top-0 z-20 bg-white/70 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* سمت راست - لوگو */}
          <div className="flex items-center gap-3">
            {/* 👇 لوگو را در پوشه public بگذار، مثلاً /logo.png */}
            <img src="/logo.png" alt="SUP Logo" className="h-8 w-8 rounded-md" />
            <h1 className="text-lg sm:text-xl font-extrabold text-gray-800">نگرش هوشمند شهری</h1>
          </div>

          {/* سمت چپ - آیکون‌ها */}
          <div className="flex items-center gap-3 text-gray-500">
            <Search size={18} />
            <HelpCircle size={18} />
            <Bell size={18} />
          </div>
        </div>
      </header>

      {/* بدنه اصلی */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <GlassPanel
            title="پنل مدیریتی"
            subtitle="Administrative Dashboard"
          >
            <div className="grid grid-cols-3 gap-4">
              {adminCards.map((c, i) => <DashCard key={i} card={c} />)}
            </div>
          </GlassPanel>

          <GlassPanel
            title="پنل کاربری"
            subtitle="Citizen Dashboard "
          >
            <div className="grid grid-cols-3 gap-4">
              {citizenCards.map((c, i) => <DashCard key={i} card={c} />)}
            </div>
          </GlassPanel>
        </div>

        {/* فوتر */}
        <div className="mt-10 flex items-center justify-between text-xs text-gray-400">
          <span>Resources • Legal</span>
          <div className="flex items-center gap-3">
            <span>YouTube</span>
            <span>LinkedIn</span>
          </div>
        </div>
      </main>
    </div>
  );
}
