import Home from "@/pages/Home";
import Discover from "@/pages/Discover";
import { Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/discover" element={<Discover />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
