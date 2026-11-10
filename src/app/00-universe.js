const currencies = ["XAU", "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "LINK", "AVAX",
  "LTC", "BCH", "XLM", "TRX", "ETC", "FIL", "HBAR", "ICP", "VET", "ALGO", "GRT", "SAND", "MANA", "IMX", "THETA", "RUNE", "FLOKI", "WLD", "TON", "EOS", "XTZ", "CHZ", "GALA", "APE", "DYDX", "PYTH", "JTO", "ORDI", "PENDLE", "EIGEN",
  "SHIB", "MATIC", "POL", "UNI", "ATOM", "LUNC", "NEAR", "APT", "ARB", "OP", "INJ", "SUI", "FET", "WIF", "PEPE", "BONK", "ETHFI", "TIA", "SEI", "JUP", "RENDER", "ONDO", "TAO", "JASMY", "ENA", "AAVE", "MKR", "CRV", "LDO", "STX",
  "EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SGD", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON", "ISK", "BGN", "TRY", "ZAR", "MXN", "BRL", "CNY", "HKD", "THB", "INR", "KRW", "ILS"];
const names = {
  XAU: "Gold",
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "Ripple",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  LINK: "Chainlink",
  AVAX: "Avalanche",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  XLM: "Stellar",
  TRX: "TRON",
  ETC: "Ethereum Classic",
  FIL: "Filecoin",
  HBAR: "Hedera",
  ICP: "Internet Computer",
  VET: "VeChain",
  ALGO: "Algorand",
  GRT: "The Graph",
  SAND: "The Sandbox",
  MANA: "Decentraland",
  IMX: "Immutable",
  THETA: "Theta",
  RUNE: "THORChain",
  FLOKI: "Floki",
  WLD: "Worldcoin",
  TON: "Toncoin",
  EOS: "EOS",
  XTZ: "Tezos",
  CHZ: "Chiliz",
  GALA: "Gala",
  APE: "ApeCoin",
  DYDX: "dYdX",
  PYTH: "Pyth Network",
  JTO: "Jito",
  ORDI: "ORDI",
  PENDLE: "Pendle",
  EIGEN: "EigenLayer",
  SHIB: "Shiba Inu",
  MATIC: "Polygon",
  POL: "Polygon Ecosystem",
  UNI: "Uniswap",
  ATOM: "Cosmos",
  LUNC: "Terra Classic",
  NEAR: "NEAR Protocol",
  APT: "Aptos",
  ARB: "Arbitrum",
  OP: "Optimism",
  INJ: "Injective",
  SUI: "Sui",
  FET: "Artificial Superintelligence",
  WIF: "dogwifhat",
  PEPE: "Pepe",
  BONK: "Bonk",
  ETHFI: "Ether.fi",
  TIA: "Celestia",
  SEI: "Sei",
  JUP: "Jupiter",
  RENDER: "Render",
  ONDO: "Ondo",
  TAO: "Bittensor",
  JASMY: "JasmyCoin",
  ENA: "Ethena",
  AAVE: "Aave",
  MKR: "Maker",
  CRV: "Curve DAO",
  LDO: "Lido DAO",
  STX: "Stacks",
  EUR: "Euro",
  USD: "US Dollar",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  NZD: "New Zealand Dollar",
  SGD: "Singapore Dollar",
  NOK: "Norwegian Krone",
  SEK: "Swedish Krona",
  DKK: "Danish Krone",
  PLN: "Polish Zloty",
  CZK: "Czech Koruna",
  HUF: "Hungarian Forint",
  RON: "Romanian Leu",
  ISK: "Icelandic Krona",
  BGN: "Bulgarian Lev",
  TRY: "Turkish Lira",
  ZAR: "South African Rand",
  MXN: "Mexican Peso",
  BRL: "Brazilian Real",
  CNY: "Chinese Yuan",
  HKD: "Hong Kong Dollar",
  THB: "Thai Baht",
  INR: "Indian Rupee",
  KRW: "South Korean Won",
  ILS: "Israeli Shekel",
};

const nonFiat = new Set(["XAU", "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "LINK", "AVAX", "SHIB", "LTC", "MATIC", "POL", "UNI", "ATOM", "LUNC", "NEAR", "APT", "ARB", "OP", "INJ", "SUI", "FET", "WIF", "PEPE", "BONK", "ETHFI", "TIA", "SEI", "JUP", "RENDER", "ONDO", "TAO", "JASMY", "ENA", "AAVE", "MKR", "CRV", "LDO", "STX", "BCH", "XLM", "TRX", "ETC", "FIL", "HBAR", "ICP", "VET", "ALGO", "GRT", "SAND", "MANA", "IMX", "THETA", "RUNE", "FLOKI", "WLD", "TON", "EOS", "XTZ", "CHZ", "GALA", "APE", "DYDX", "PYTH", "JTO", "ORDI", "PENDLE", "EIGEN"]);
// Only these fiat currencies have a live Binance USDT book. NZD was removed:
// Binance has no NZDUSDT market, so requesting it returned a 400 on every scan.
const binanceFiat = new Set(["EUR", "GBP", "AUD"]);
// Frankfurter dropped BGN when Bulgaria adopted the euro, so a from=BGN request
// 404s. Route unsupported legs through the currency-api fallback instead.
const frankfurterCurrencies = new Set(["AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR"]);

const state = {
  base: "EUR",
  quote: "USD",
  rows: [],
  status: "loading",
  error: "",
  source: "",
  timeframe: "1d",
  mtf: {},
  notice: "",
  isDemo: false,
  cacheLabel: "",
};

let activeDataRequestId = 0;
let activeLoadId = 0;

const autoScan = {
  enabled: false,
  intervalId: null,
  history: [],
  maxEntries: 50,
  // Lifetime total of signals ever recorded, so the badge keeps counting after
  // the retained history is capped (the log itself only keeps maxEntries rows).
  totalGenerated: 0,
};

const alertConditions = {
  mtf_alignment: { type: "mtf_alignment", enabled: false, threshold: 0, lastFired: 0 },
  pattern_trend: { type: "pattern_trend", enabled: false, threshold: 0, lastFired: 0 },
  high_confidence: { type: "high_confidence", enabled: false, threshold: 85, lastFired: 0 },
  volume_surge: { type: "volume_surge", enabled: false, threshold: 1.5, lastFired: 0 },
  lastTestResult: "",
};

let alertHistory = [];
let strategyName = "";
let ichimokuOverlay = false;
let fibOverlay = false;
let macdHistVote = false;
let kellyEnabled = false;
let vwapOverlay = false;
let mlFilterEnabled = false;
let priceLevelAlerts = [];
let slippageConfig = { spreadPips: 0, slippagePips: 0 };
let trailingAtrMult = 3;
let initialRrMult = 1.5;
const lastSignals = new Map();

