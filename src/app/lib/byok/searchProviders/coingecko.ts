import type { SearchProvider } from "./types"

export const coingeckoProvider: SearchProvider = {
  name: "market_context",
  execute: async (args) => {
    const coinId = args.coin_id as string | undefined
    if (!coinId) {
      return { tool_name: "market_context", results: [], error: "Missing coin_id" }
    }

    try {
      // CoinGecko public API is free and doesn't require a key, but has strict rate limits.
      // E.g., for bitcoin: /simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true
      const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
      const res = await fetch(url)

      if (!res.ok) {
        throw new Error(`CoinGecko API error: ${res.status}`)
      }

      const data = await res.json()
      
      const marketData = data.market_data
      const content = `Market Data for ${data.name} (${data.symbol.toUpperCase()}):
- Current Price: $${marketData.current_price.usd}
- Market Cap: $${marketData.market_cap.usd}
- 24h Volume: $${marketData.total_volume.usd}
- 24h Change: ${marketData.price_change_percentage_24h}%
- All Time High: $${marketData.ath.usd} (on ${marketData.ath_date.usd})`

      return {
        tool_name: "market_context",
        results: [
          {
            title: `${data.name} Market Context`,
            url: `https://www.coingecko.com/en/coins/${data.id}`,
            content: content,
          }
        ],
      }
    } catch (e) {
      return { tool_name: "market_context", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
