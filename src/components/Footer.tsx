export default function Footer() {
  return (
    <footer className="bg-black py-16 border-t border-white/5 relative z-10">
      <div className="max-w-4xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          
          <div className="col-span-1">
            <div className="flex items-center space-x-2 mb-4">
              <img src="/logo.svg" alt="Solana Bot Ecosystem Logo" className="w-8 h-8" />
              <span className="text-xl font-bold text-white tracking-wider">SimplyBots</span>
            </div>
            <p className="text-gray-500 max-w-sm">
              Interconnected Telegram bots for token projects: alerts, leaderboard, and highlights in one synced ecosystem.
            </p>
          </div>

          <div className="md:ml-auto">
            <h4 className="font-bold mb-4 text-white">Bots & Channel</h4>
            <ul className="space-y-2 text-sm text-gray-500">
              <li><a href="https://t.me/SolBananaBot" className="hover:text-banana transition-colors">@SolBananaBot</a></li>
              <li><a href="https://t.me/SolSnackBot" className="hover:text-solana-green transition-colors">@SolSnackBot</a></li>
              <li><a href="https://t.me/Simplypumping" className="hover:text-solana-purple transition-colors">@Simplypumping</a></li>
            </ul>
          </div>

        </div>

        <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-white/10 text-sm text-gray-600">
          <div className="text-center md:text-left">
            <p>© {new Date().getFullYear()} SimplyBots. All rights reserved.</p>
            <p className="mt-1">Built on Solana</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
