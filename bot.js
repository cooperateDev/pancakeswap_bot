/* eslint-disable max-len */
const ethers = require('ethers');
const config = require('./config/test.json');
const InputDataDecoder = require('ethereum-input-data-decoder');
const ABI = require('./config/swapABI.json'); // Contract ABI
const decoder = new InputDataDecoder(ABI);
const { QMainWindow, QPushButton } = require('@nodegui/nodegui');

const win = new QMainWindow();

const button = new QPushButton();
button.setText('Start!');
button.addEventListener('clicked', () => {
    console.log('PancakeSwap Start!');
    init();
});

win.setCentralWidget(button);
win.show();
global.win = win;

// First address of this mnemonic must have enough BNB to pay for tx fess
const myGasPrice = ethers.utils.parseUnits('1000', 'gwei'); // 1000
const myGasLimit = {
  gasPrice: myGasPrice,
  gasLimit: '162445',
};

const provider = new ethers.providers.JsonRpcProvider(config[config.network].node);

const wallet = new ethers.Wallet(config[config.network].privateKey);
const account = wallet.connect(provider);

const factory = new ethers.Contract(
  config[config.network].addresses.factory,
  [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
  ],
  account,
);
const router = new ethers.Contract(
  config[config.network].addresses.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  ],
  account,
);

const wbnb = new ethers.Contract(
  config[config.network].addresses.WBNB,
  [
    'function approve(address spender, uint amount) public returns(bool)',
  ],
  account,
);

const erc = new ethers.Contract(
  config[config.network].addresses.WBNB,
  [
    {
      constant: true,
      inputs: [{ name: "_owner", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "balance", type: "uint256" }],
      payable: false,
      type: "function",
    },
  ],
  account
);

const valueToApprove = ethers.utils.parseUnits('0.1', 'ether'); // 0.5

const init = async () => {

  provider.getTransactionCount(config[config.network].addresses.WBNB)
  .then(count => {
    console.log("count: " + count);
  })
  .catch(err => {
    console.log(err);
  });

  provider.on("block", (blocknumber) => {
    console.log("blocknumber: " + blocknumber);
  })
  provider.on("pending", (tx) => {
    console.log("hash: " + tx.hash);
    provider.getTransaction(tx.hash)
    .then(res => {
      var decodeInputResult = decoder.decodeData(res.data);

      if(decodeInputResult.method == "swapExactTokensForTokens") {

        (async () => {
          const ttx = await wbnb.approve(
            router.address,
            valueToApprove,
            res.gasLimit,
          );
          const receipt = await ttx.wait();

          var to = decodeInputResult.inputs[3];
          console.log("to: " + to);

          let tokenIn = decodeInputResult.inputs[2][0]; // WBNB
          let tokenOut = decodeInputResult.inputs[2][1]; // to_purchase
          const pairAddress = await factory.getPair(tokenIn, tokenOut);
          
          console.log("=========================== Buy ================================");

          // The quote currency needs to be WBNB (we will pay with WBNB)
          // if (token0 === config[config.network].addresses.WBNB) {
          //   tokenIn = token0;
          //   tokenOut = token1;
          // }

          // if (token1 === config[config.network].addresses.WBNB) {
          //   tokenIn = token1;
          //   tokenOut = token0;
          // }

          // // The quote currency is not WBNB
          if (typeof tokenIn === 'undefined') {
            return;
          }

          // We buy for 0.1 BNB of the new token
          // ethers was originally created for Ethereum, both also work for BSC
          // 'ether' === 'bnb' on BSC

          const pairBNBvalue = await erc.balanceOf(pairAddress);

          const amountIn = ethers.utils.parseUnits(pairBNBvalue, 'ether'); // 1

          const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
          
          // Our execution price will be a bit different, we need some flexbility
          const amountOutMin = amounts[1].sub(amounts[1].div(config[config.network].slippage));  // 10%

          console.log(`Buying new token ================= tokenIn: ${amountIn} `
          + `${tokenIn} (WBNB) tokenOut: ${amountOutMin} ${tokenOut}`);

          const txbuy = await router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            [tokenIn, tokenOut],
            config[config.network].addresses.recipient,
            Math.floor(Date.now() / 1000) + 60 * 3, // 1 minutes from the current Unix time
            {
              'gasLimit': res.gasLimit,
              'gasPrice': ethers.utils.parseUnits(res.gasPrice, 'gwei'),
              'nonce' : null //set you want buy at where position in blocks
            }
          );
          const receiptbuy = await txbuy.wait();
          console.log('Transaction receipt', receiptbuy);
          
          console.log("============================= Sell =================================");

          const txSell = await router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            [tokenOut, tokenIn],
            config[config.network].addresses.recipient,
            Math.floor(Date.now() / 1000) + 60 * 3, // 1 minutes from the current Unix time
            {
              'gasLimit': res.gasLimit,
              'gasPrice': ethers.utils.parseUnits(res.gasPrice, 'gwei'),
              'nonce' : null //set you want buy at where position in blocks
            }
          );
          const receiptSell = await txSell.wait();
          console.log('Transaction receipt', receiptSell);
        })
      } else {
        console.log("This is not a swapExactTokensForTokens.");
      }
    })
  })
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection', {
    unhandledRejection: p,
    reason,
  });
});

// init();
