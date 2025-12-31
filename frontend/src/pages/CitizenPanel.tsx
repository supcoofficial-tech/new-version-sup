// src/pages/CitizenPanel.tsx
import { Link } from "react-router-dom";
import { Sun, Users, CalendarDays, Bus, Home, Landmark } from "lucide-react";

type Card = { title: string; link: string; color: string; icon: JSX.Element };

const DashCard: React.FC<{ card: Card }> = ({ card }) => (
  <Link
    to={card.link}
    className={`group rounded-2xl p-5 text-center border border-white/40 shadow-md bg-gradient-to-br ${card.color} backdrop-blur-md transition-all hover:shadow-xl`}
  >
    <div className="flex justify-center mb-3 text-gray-700 group-hover:scale-110 transition">
      {card.icon}
    </div>
    <div className="text-[13px] font-semibold text-gray-800 leading-5">
      {card.title}
    </div>
  </Link>
);

export default function CitizenPanel() {
  const citizenCards: Card[] = [
    {
      title: "آب و هوا",
      link: "/site-weather",
      color: "from-cyan-100/80 to-sky-100/70",
      icon: <Sun size={28} />,
    },
    {
      title: "مشارکت",
      link: "/citizen/participation",
      color: "from-pink-100/80 to-rose-100/70",
      icon: <Users size={28} />,
    },
    {
      title: "رویدادها",
      link: "/citizen/events",
      color: "from-purple-100/80 to-violet-100/70",
      icon: <CalendarDays size={28} />,
    },
    {
      title: "حمل و نقل",
      link: "/citizen/transport",
      color: "from-emerald-100/80 to-teal-100/70",
      icon: <Bus size={28} />,
    },
    {
      title: "واحد همسایگی",
      link: "/citizen/neighborhood",
      color: "from-emerald-100/80 to-teal-100/70",
      icon: <Home size={28} />,
    },
    {
      title: "تفریحی و گردشگری",
      link: "/citizen/tourism",
      color: "from-rose-100/80 to-pink-100/70",
      icon: <Landmark size={28} />,
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-pink-50 py-10 px-6">
      <h1 className="text-xl font-extrabold text-gray-800 mb-8 text-center">
        👥 پنل کاربری
      </h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {citizenCards.map((c, i) => (
          <DashCard key={i} card={c} />
        ))}
      </div>
    </div>
  );
}
