// src/pages/AdminPanel.tsx
import { Link } from "react-router-dom";
import { Building2, TreePine, Mountain, Bus, Bolt, Landmark } from "lucide-react";

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

export default function AdminPanel() {
  const adminCards: Card[] = [
    {
      title: "(2D) توسعه شهری",
      link: "/urban-dev",
      color: "from-cyan-100/80 to-emerald-100/70",
      icon: <Building2 size={28} />,
    },
    {
      title: "(2D) اکولوژی",
      link: "/resilience",
      color: "from-green-100/80 to-lime-100/70",
      icon: <TreePine size={28} />,
    },
    {
      title: "(3D) منظر شهری",
      link: "/unity-sim",
      color: "from-violet-100/80 to-purple-100/70",
      icon: <Mountain size={28} />,
    },
    {
      title: "(2D) حمل و نقل",
      link: "/transport",
      color: "from-sky-100/80 to-indigo-100/70",
      icon: <Bus size={28} />,
    },
    {
      title: "انرژی",
      link: "/admin/energy",
      color: "from-amber-100/80 to-orange-100/70",
      icon: <Bolt size={28} />,
    },
    {
      title: "گردشگری",
      link: "/admin/tourism",
      color: "from-rose-100/80 to-pink-100/70",
      icon: <Landmark size={28} />,
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-pink-50 py-10 px-6">
      <h1 className="text-xl font-extrabold text-gray-800 mb-8 text-center">
        🏛️ پنل مدیریتی
      </h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {adminCards.map((c, i) => (
          <DashCard key={i} card={c} />
        ))}
      </div>
    </div>
  );
}
