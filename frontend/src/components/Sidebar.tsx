import { Link, useLocation } from "react-router-dom";

const NavItem = ({ to, children }: { to: string; children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const active = pathname === to;

  return (
    <li>
      <Link
        to={to}
        className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          active
            ? "bg-blue-100 text-blue-700 shadow-sm"
            : "text-gray-600 hover:bg-blue-50 hover:text-blue-700"
        }`}
      >
        {children}
      </Link>
    </li>
  );
};

export default function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-white/80 backdrop-blur-md border-r border-gray-200 text-gray-800 p-5 sticky top-0 shadow-sm">
      {/* هدر لوگو */}
      <div className="flex items-center gap-2 mb-8">
        {/* 👇 لوگو را بعداً در public/logo.png قرار بده */}
        <img src="/logo.png" alt="SUP Logo" className="h-8 w-8 rounded-md" />
        <h2 className="text-xl font-extrabold text-blue-700 tracking-tight">
        SUP Panel
        </h2>
      </div>

      <nav className="space-y-5">
        <div>
          <p className="text-gray-500 mb-2 font-semibold text-sm">کاربری</p>
          <ul className="space-y-1">
            <NavItem to="/dashboard">داشبورد اصلی </NavItem>
            <NavItem to="/simulation">شبیه سازی</NavItem>
           <NavItem to="/admin-panel">پنل مدیریتی</NavItem>
<NavItem to="/citizen-panel">پنل کاربری</NavItem>

          </ul>
        </div>
      </nav>

      {/* فوتر */}
      <div className="absolute bottom-6 left-0 w-full text-center text-xs text-gray-400">
        <p>© 2025 Smart Urban Perspective</p>
      </div>
    </aside>
  );
}
