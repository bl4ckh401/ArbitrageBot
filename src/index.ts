// Import necessary libraries and packages
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import winston from 'winston';
import BN from 'bn.js';


// Load environment variables from .env
dotenv.config();

// Configuration for the system, including RPC URLs and token addresses
const config = {
  ethereum: {
    rpcUrl:
      process.env.ETHEREUM_RPC_URL ||
      'https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID',
    privateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
    gasLimit: 500000,
  },
  bsc: {
    rpcUrl:
      process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    privateKey: process.env.BSC_PRIVATE_KEY || '',
    gasLimit: 500000,
  },
  uniswap: {
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  },
  pancakeswap: {
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  },
  tokens: {
    WETH: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      decimals: 18,
    },
    USDC: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    },
    BUSD: {
      address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      symbol: 'BUSD',
      decimals: 18,
    },
    WBNB: {
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      symbol: 'WBNB',
      decimals: 18,
    },
  },
  profitThreshold: 0.5, // 0.5%
  maxSlippage: 1, // 1%
};

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) =>
        `${timestamp} [${level.toUpperCase()}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
    }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// ABIs
const UniswapV2Router02ABI = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
];

const ERC20ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// Helper functions
function calculatePriceImpact(
  amount: string,
  reserveIn: string,
  reserveOut: string
): number {
  const amountBN = ethers.BigNumber.from(amount);
  const reserveInBN = ethers.BigNumber.from(reserveIn);
  const reserveOutBN = ethers.BigNumber.from(reserveOut);

  const numerator = amountBN.mul(reserveOutBN);
  const denominator = reserveInBN.add(amountBN).mul(1000);
  const priceImpact =
    numerator.mul(1000).div(denominator).toNumber() / 1000;

  return priceImpact;
}

function calculateOptimalTrade(
    reserveIn: string,
    reserveOut: string
  ): string {
    const reserveInBN = new BN(reserveIn);
    const reserveOutBN = new BN(reserveOut);
  
    const optimalAmount = reserveInBN.mul(reserveOutBN).sqrt();
    return optimalAmount.toString();
  }
  

// Opportunity Model
class OpportunityModel {
  id: string;
  sourceExchange: string;
  targetExchange: string;
  tokenIn: any;
  tokenOut: any;
  amountIn: string;
  expectedProfit: string;
  route: string[];

  constructor(
    sourceExchange: string,
    targetExchange: string,
    tokenIn: any,
    tokenOut: any,
    amountIn: string,
    expectedProfit: string,
    route: string[]
  ) {
    this.id = uuidv4();
    this.sourceExchange = sourceExchange;
    this.targetExchange = targetExchange;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    this.amountIn = amountIn;
    this.expectedProfit = expectedProfit;
    this.route = route;
  }
}

// Transaction Model
class TransactionModel {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;

  constructor(
    hash: string,
    from: string,
    to: string,
    value: string,
    gasPrice: string,
    gasLimit: string
  ) {
    this.hash = hash;
    this.from = from;
    this.to = to;
    this.value = value;
    this.gasPrice = gasPrice;
    this.gasLimit = gasLimit;
  }
}

// Integration Services
class EthereumIntegration {
  provider: ethers.providers.JsonRpcProvider;
  wallet: ethers.Wallet;
  routerContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(
      config.ethereum.rpcUrl
    );
    this.wallet = new ethers.Wallet(
      config.ethereum.privateKey,
      this.provider
    );
    this.routerContract = new ethers.Contract(
      config.uniswap.router,
      UniswapV2Router02ABI,
      this.wallet
    );
  }

  async getBalance(address: string): Promise<string> {
    return (await this.provider.getBalance(address)).toString();
  }

  async swap(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<TransactionModel> {
    try {
      const tokenInContract = new ethers.Contract(
        tokenIn,
        ERC20ABI,
        this.wallet
      );

      const amountInBN = ethers.BigNumber.from(amountIn);

      // Check balance
      const balance = await tokenInContract.balanceOf(
        this.wallet.address
      );
      if (balance.lt(amountInBN)) {
        throw new Error('Insufficient token balance');
      }

      // Check allowance
      const allowance = await tokenInContract.allowance(
        this.wallet.address,
        this.routerContract.address
      );
      if (allowance.lt(amountInBN)) {
        // Approve token
        const approveTx = await tokenInContract.approve(
          this.routerContract.address,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();
      }

      const amountOutMin = 0; // For now, no slippage protection
      const path = [tokenIn, tokenOut];
      const to = this.wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

      const gasLimit = config.ethereum.gasLimit;

      const swapTx = await this.routerContract.swapExactTokensForTokens(
        amountInBN,
        amountOutMin,
        path,
        to,
        deadline,
        {
          gasLimit,
        }
      );

      const receipt = await swapTx.wait();

      return new TransactionModel(
        swapTx.hash,
        swapTx.from,
        swapTx.to,
        amountInBN.toString(),
        swapTx.gasPrice.toString(),
        swapTx.gasLimit.toString()
      );
    } catch (error) {
      logger.error(`Error executing swap on Ethereum: ${error}`);
      throw error;
    }
  }
}

class BSCIntegration {
  provider: ethers.providers.JsonRpcProvider;
  wallet: ethers.Wallet;
  routerContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(
      config.bsc.rpcUrl
    );
    this.wallet = new ethers.Wallet(
      config.bsc.privateKey,
      this.provider
    );
    this.routerContract = new ethers.Contract(
      config.pancakeswap.router,
      UniswapV2Router02ABI,
      this.wallet
    );
  }

  async getBalance(address: string): Promise<string> {
    return (await this.provider.getBalance(address)).toString();
  }

  async swap(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<TransactionModel> {
    try {
      const tokenInContract = new ethers.Contract(
        tokenIn,
        ERC20ABI,
        this.wallet
      );

      const amountInBN = ethers.BigNumber.from(amountIn);

      // Check balance
      const balance = await tokenInContract.balanceOf(
        this.wallet.address
      );
      if (balance.lt(amountInBN)) {
        throw new Error('Insufficient token balance');
      }

      // Check allowance
      const allowance = await tokenInContract.allowance(
        this.wallet.address,
        this.routerContract.address
      );
      if (allowance.lt(amountInBN)) {
        // Approve token
        const approveTx = await tokenInContract.approve(
          this.routerContract.address,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();
      }

      const amountOutMin = 0; // For now, no slippage protection
      const path = [tokenIn, tokenOut];
      const to = this.wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

      const gasLimit = config.bsc.gasLimit;

      const swapTx = await this.routerContract.swapExactTokensForTokens(
        amountInBN,
        amountOutMin,
        path,
        to,
        deadline,
        {
          gasLimit,
        }
      );

      const receipt = await swapTx.wait();

      return new TransactionModel(
        swapTx.hash,
        swapTx.from,
        swapTx.to,
        amountInBN.toString(),
        swapTx.gasPrice.toString(),
        swapTx.gasLimit.toString()
      );
    } catch (error) {
      logger.error(`Error executing swap on BSC: ${error}`);
      throw error;
    }
  }
}

// Services
class MarketDataService {
  ethereumProvider: ethers.providers.JsonRpcProvider;
  bscProvider: ethers.providers.JsonRpcProvider;

  constructor() {
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(
      config.ethereum.rpcUrl
    );
    this.bscProvider = new ethers.providers.JsonRpcProvider(
      config.bsc.rpcUrl
    );
  }

  async getPriceData(
    tokenIn: any,
    tokenOut: any,
    amountIn: ethers.BigNumber,
    exchange: string
  ): Promise<ethers.BigNumber> {
    try {
      let provider;
      let routerAddress;
      if (exchange === 'uniswap') {
        provider = this.ethereumProvider;
        routerAddress = config.uniswap.router;
      } else if (exchange === 'pancakeswap') {
        provider = this.bscProvider;
        routerAddress = config.pancakeswap.router;
      } else {
        throw new Error(`Unknown exchange: ${exchange}`);
      }

      const routerContract = new ethers.Contract(
        routerAddress,
        UniswapV2Router02ABI,
        provider
      );

      const amountsOut = await routerContract.getAmountsOut(amountIn, [
        tokenIn.address,
        tokenOut.address,
      ]);

      const amountOut = amountsOut[1];

      return amountOut;
    } catch (error) {
      logger.error(
        `Error fetching price data for ${tokenIn.symbol} to ${tokenOut.symbol} on ${exchange}: ${error}`
      );
      throw error;
    }
  }
}

class OpportunityFinderService {
  private marketDataService: MarketDataService;

  constructor(marketDataService: MarketDataService) {
    this.marketDataService = marketDataService;
  }

  async findArbitrageOpportunities(): Promise<OpportunityModel[]> {
    const opportunities: OpportunityModel[] = [];
    const exchanges = ['uniswap', 'pancakeswap'];
    const tokens = [
      config.tokens.WETH,
      config.tokens.USDC,
      config.tokens.BUSD,
      config.tokens.WBNB,
    ];

    for (const tokenIn of tokens) {
      for (const tokenOut of tokens) {
        if (tokenIn.address !== tokenOut.address) {
          for (const sourceExchange of exchanges) {
            for (const targetExchange of exchanges) {
              if (sourceExchange !== targetExchange) {
                try {
                  const opportunity =
                    await this.checkArbitrageOpportunity(
                      sourceExchange,
                      targetExchange,
                      tokenIn,
                      tokenOut
                    );
                  if (opportunity) opportunities.push(opportunity);
                } catch (error) {
                  logger.error(
                    `Error checking arbitrage opportunity: ${error}`
                  );
                }
              }
            }
          }
        }
      }
    }

    return opportunities;
  }

  private async checkArbitrageOpportunity(
    sourceExchange: string,
    targetExchange: string,
    tokenIn: any,
    tokenOut: any
  ): Promise<OpportunityModel | null> {
    const amountIn = ethers.utils.parseUnits(
      '1',
      tokenIn.decimals
    );
    const sourceAmountOut = await this.marketDataService.getPriceData(
      tokenIn,
      tokenOut,
      amountIn,
      sourceExchange
    );
    const targetAmountOut = await this.marketDataService.getPriceData(
      tokenIn,
      tokenOut,
      amountIn,
      targetExchange
    );

    if (targetAmountOut.gt(sourceAmountOut)) {
      const profit = targetAmountOut.sub(sourceAmountOut);
      const profitPercentage =
        profit.mul(10000).div(sourceAmountOut).toNumber() / 100;

      if (profitPercentage > config.profitThreshold) {
        return new OpportunityModel(
          sourceExchange,
          targetExchange,
          tokenIn,
          tokenOut,
          amountIn.toString(),
          profit.toString(),
          [tokenIn.address, tokenOut.address]
        );
      }
    }

    return null;
  }
}

class ExecutionService {
  private ethereumIntegration: EthereumIntegration;
  private bscIntegration: BSCIntegration;

  constructor() {
    this.ethereumIntegration = new EthereumIntegration();
    this.bscIntegration = new BSCIntegration();
  }

  async executeArbitrage(
    opportunity: OpportunityModel
  ): Promise<TransactionModel | null> {
    try {
      let buyTransaction: TransactionModel | null = null;
      let sellTransaction: TransactionModel | null = null;

      // Buy on source exchange
      if (opportunity.sourceExchange === 'uniswap') {
        buyTransaction = await this.ethereumIntegration.swap(
          opportunity.tokenIn.address,
          opportunity.tokenOut.address,
          opportunity.amountIn
        );
      } else if (opportunity.sourceExchange === 'pancakeswap') {
        buyTransaction = await this.bscIntegration.swap(
          opportunity.tokenIn.address,
          opportunity.tokenOut.address,
          opportunity.amountIn
        );
      }

      // Note: Cross-chain arbitrage requires bridging assets, which is complex and time-consuming.
      // For this example, we assume the asset can be moved instantly between chains (which is not practical in reality).
      // In practice, arbitrage is performed within the same chain.

      // Sell on target exchange
      if (opportunity.targetExchange === 'uniswap') {
        sellTransaction = await this.ethereumIntegration.swap(
          opportunity.tokenOut.address,
          opportunity.tokenIn.address,
          buyTransaction!.value // Assuming same amount
        );
      } else if (opportunity.targetExchange === 'pancakeswap') {
        sellTransaction = await this.bscIntegration.swap(
          opportunity.tokenOut.address,
          opportunity.tokenIn.address,
          buyTransaction!.value
        );
      }

      if (!buyTransaction || !sellTransaction) {
        logger.error(
          `Failed to execute trade for opportunity ${opportunity.id}`
        );
        return null;
      }

      logger.info(
        `Successfully executed arbitrage for opportunity ${opportunity.id}`
      );
      return sellTransaction;
    } catch (error) {
      logger.error(
        `Error executing arbitrage for opportunity ${opportunity.id}: ${error}`
      );
      return null;
    }
  }
}

// Entry Point
(async () => {
  const marketDataService = new MarketDataService();
  const opportunityFinderService = new OpportunityFinderService(
    marketDataService
  );
  const executionService = new ExecutionService();

  logger.info('Starting arbitrage opportunity finder...');

  const opportunities =
    await opportunityFinderService.findArbitrageOpportunities();

  if (opportunities.length === 0) {
    logger.info('No arbitrage opportunities found.');
    return;
  }

  for (const opportunity of opportunities) {
    logger.info(`Evaluating opportunity ${opportunity.id}`);
    const success = await executionService.executeArbitrage(opportunity);
    if (success) {
      logger.info(`Successfully executed opportunity ${opportunity.id}`);
    } else {
      logger.warn(`Failed to execute opportunity ${opportunity.id}`);
    }
  }
})();


//Have fun
