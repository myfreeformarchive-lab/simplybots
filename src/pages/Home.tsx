import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import LiveLeaderboard from "@/components/LiveLeaderboard";
import DiamondHandsFeed from "@/components/DiamondHandsFeed";
import ShoutoutsFeed from "@/components/ShoutoutsFeed";
import Footer from "@/components/Footer";
import { Send, Twitter } from "lucide-react";

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

      <section className="pb-24">
        <div className="container mx-auto px-4">
          <div className="glass-card p-6 md:p-10 border-white/10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold">Socials</h2>
                <p className="text-gray-400 mt-2">
                  Follow updates and join the community.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="https://x.com/Simplybots1"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold"
                >
                  <Twitter className="w-5 h-5" />
                  @Simplybots1
                </a>
                <a
                  href="https://t.me/simplybots1"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold"
                >
                  <Send className="w-5 h-5 text-solana-green" />
                  Simplybots Lab
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
