import LiveLeaderboard from "@/components/LiveLeaderboard";
import DiamondHandsFeed from "@/components/DiamondHandsFeed";
import ShoutoutsFeed from "@/components/ShoutoutsFeed";
import LeaderboardHistoryTicker from "@/components/LeaderboardHistoryTicker";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white selection:bg-solana-purple/30 selection:text-white">
      <LeaderboardHistoryTicker />

      <section className="relative" style={{ paddingTop: 85, paddingBottom: 85 }}>
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-6">
              <LiveLeaderboard />
            </div>
            <div className="lg:col-span-3">
              <DiamondHandsFeed />
            </div>
            <div className="lg:col-span-3">
              <ShoutoutsFeed />
            </div>
          </div>
        </div>
      </section>

      <section className="pb-24">
        <div className="w-full px-3 sm:px-6 lg:px-8">
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
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M18.901 1.153h3.686l-8.052 9.2 9.472 12.514H16.62l-5.79-7.567-6.62 7.567H.52l8.614-9.85L.052 1.153h7.58l5.23 6.913 6.039-6.913Zm-1.294 19.51h2.043L6.52 3.24H4.33l13.277 17.422Z"
                    />
                  </svg>
                  @Simplybots1
                </a>
                <a
                  href="https://t.me/simplybots1"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" fill="#2AABEE"/>
                  </svg>
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
