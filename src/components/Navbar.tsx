import { motion } from "framer-motion";

export default function Navbar() {
  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50 glass-card border-x-0 border-t-0 rounded-none bg-black/50 backdrop-blur-xl"
    >
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <img src="/logo.svg" alt="Solana Bot Ecosystem Logo" className="w-8 h-8" />
          <div className="flex flex-col leading-tight">
            <span className="text-xl font-bold text-white tracking-wider">SimplyBots</span>
            <div className="md:hidden flex items-center gap-2 text-[11px] font-medium text-gray-400">
              <a href="https://myfreeform.page" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
                Powered by myfreeform.page
              </a>
              <span>&middot;</span>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" fill="#2AABEE"/>
                </svg>
                <span>Built for Telegram</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs font-medium text-gray-400">
          <a href="https://myfreeform.page" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
            Powered by myfreeform.page
          </a>
          <span>&middot;</span>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" fill="#2AABEE"/>
            </svg>
            <span>Built for Telegram</span>
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
