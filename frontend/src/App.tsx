import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import "leaflet/dist/leaflet.css";

// صفحات اصلی
import Dashboard from "./pages/Dashboard";
import Simulation from "./pages/Simulation";
import Participation from "./pages/Participation";
import BaseMaps from "./pages/BaseMaps";
import Reports from "./pages/Reports";
import UploadData from "./pages/UploadData";
import UnityLikeSim from "./pages/UnityLikeSim";
import ClimateResilience from "./pages/ClimateResilience";
import UrbanDevelopment from "./pages/UrbanDevelopment";
// صفحات جدید
import AdminPanel from "./pages/AdminPanel";
import CitizenPanel from "./pages/CitizenPanel";
import Transport from "./pages/transport";
import SiteWeather from "./pages/SiteWeather";
export default function App() {
  return (
    <Router>
      <div className="flex">
        <Sidebar />
        <div className="flex-1 p-6 min-h-screen bg-gray-100">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/unity-sim" element={<UnityLikeSim />} />
            <Route path="/resilience" element={<ClimateResilience />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/participation" element={<Participation />} />
            <Route path="/base-maps" element={<BaseMaps />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/upload" element={<UploadData />} />
<Route path="/urban-dev" element={<UrbanDevelopment />} />
            {/* مسیرهای جدید */}
            <Route path="/admin-panel" element={<AdminPanel />} />
            <Route path="/citizen-panel" element={<CitizenPanel />} />
       <Route path="/transport" element={<Transport />} />
<Route path="/site-weather" element={<SiteWeather />} />

          </Routes>
        </div>
      </div>
    </Router>
  );
}
