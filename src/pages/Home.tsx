import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import LiveLeaderboard from "@/components/LiveLeaderboard";
import DiamondHandsFeed from "@/components/DiamondHandsFeed";
import ShoutoutsFeed from "@/components/ShoutoutsFeed";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white selection:bg-solana-purple/30 selection:text-white">
      <Navbar />
      
      <HeroSection />

      <section className="relative -mt-24 pb-24">
        <div className="container mx-auto px-4">
          <div className="mb-10">
            <h2 className="text-3xl md:text-4xl font-bold">
              Live data
            </h2>
            <p className="text-gray-400 mt-2 max-w-2xl">
              A real-time snapshot pulled directly from the SimplyBots ecosystem.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <LiveLeaderboard />
            <DiamondHandsFeed />
            <ShoutoutsFeed />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
