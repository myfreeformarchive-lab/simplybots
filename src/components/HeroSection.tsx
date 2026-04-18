import { motion } from "framer-motion";
import { ArrowRight, MessageCircle, Trophy } from "lucide-react";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-28 md:pt-20 pb-32">
      {/* Background Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-solana-purple/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-banana/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-8 leading-tight"
        >
          One Brain. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-banana via-solana-purple to-solana-green">
            Infinite Potential.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12"
        >
          Supercharge your project's Telegram group with our interconnected bots. Track buys instantly, climb the global leaderboard, and take control of your community's momentum—all seamlessly synced.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="https://t.me/SolBananaBot"
            target="_blank"
            rel="noreferrer"
            className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 bg-banana text-black font-bold rounded-xl overflow-hidden transition-transform hover:scale-105"
          >
            <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
            Add @SolBananaBot
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="https://t.me/SolSnackBot"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 glass-card font-bold rounded-xl transition-all hover:bg-white/10 hover:neon-border-green"
          >
            <Trophy className="w-5 h-5 text-solana-green" />
            Add @SolSnackBot
          </a>
          <a
            href="https://t.me/Simplypumping"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 glass-card font-bold rounded-xl transition-all hover:bg-white/10 hover:neon-border-purple"
          >
            <MessageCircle className="w-5 h-5 text-solana-purple" />
            Join @Simplypumping
          </a>
        </motion.div>
      </div>
    </section>
  );
}
