/*==================================================
  Modules
  ==================================================*/

  const _ = require('underscore');
  const sdk = require('../../sdk');
  const abi = require('./abi');
  const BigNumber = require('bignumber.js');

  /*==================================================
  Settings
  ==================================================*/

  const wETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const yyCrv = '0x5dbcF33D8c2E976c6b560249878e6F1491Bca25c';
  const yETH = '0xe1237aA7f535b0CC33Fd973D66cBf830354D16c7';

/*==================================================
  TVL
  ==================================================*/

  async function tvl(timestamp, block) {
    let balances = {
      '0x0000000000000000000000000000000000000000': '0', // ETH
    };

    let poolLogs = await sdk.api.util.getLogs({
      target: '0xf8062Eedf80D8D2527cE89435f670cb996aB4e54',
      topic: 'LOG_NEW_POOL(address,address)',
      keys: ['topics'],
      fromBlock: 10815298,
      toBlock: block
    });

    let poolCalls = [];

    let pools = _.map(poolLogs.output, (poolLog) => {
      return `0x${poolLog[2].slice(26)}`
    });

    const poolTokenData = (await sdk.api.abi.multiCall({
      calls: _.map(pools, (poolAddress) => ({ target: poolAddress })),
      abi: abi.getCurrentTokens,
    })).output;

    _.forEach(poolTokenData, (poolToken) => {
      let poolTokens = poolToken.output;
      let poolAddress = poolToken.input.target;

      _.forEach(poolTokens, (token) => {
        poolCalls.push({
          target: token,
          params: poolAddress,
        });
      })
    });

    let poolBalances = (await sdk.api.abi.multiCall({
      block,
      calls: poolCalls,
      abi: 'erc20:balanceOf'
    })).output;


    let cTokenCalls = [];
    _.each(poolBalances, (balanceOf) => {
      cTokenCalls.push({
        target: balanceOf.input.target,
        params: [],
      });
    });

    let isCTokens = (await sdk.api.abi.multiCall({
      block,
      calls: cTokenCalls,
      abi: abi['isCToken'],
    })).output;

    let underlyingBalanceCalls = [];
    let underlyingAddressCalls = [];
    _.each(isCTokens, (isCToken, i) => {
      if(isCToken.success && isCToken.output && isCToken.input.target !== yETH) {
        underlyingBalanceCalls.push({
          target: poolBalances[i].input.target,
          params: poolBalances[i].input.params,
        });
        underlyingAddressCalls.push({
          target: poolBalances[i].input.target,
          params: [],
        })
      }
    });

    let [underlyingBalances, underlyingAddress, yVaultPrices, yCrvPrice] = await Promise.all([
      sdk.api.abi.multiCall({
        block,
        calls: underlyingBalanceCalls,
        abi: abi['balanceOfUnderlying']
      }),
      sdk.api.abi.multiCall({
        block,
        calls: underlyingAddressCalls,
        abi: abi['underlying']
      }),
      sdk.api.abi.multiCall({
        block,
        calls: [{target: yETH}, {target: yyCrv}],
        abi: abi['getPricePerFullShare'],
      }),
      sdk.api.abi.call({
        block,
        target: '0x45F783CCE6B7FF23B2ab2D70e416cdb7D6055f51',
        params: [],
        abi: abi['get_virtual_price']
      })
    ]);

    underlyingBalances = underlyingBalances.output;
    underlyingAddress = underlyingAddress.output;
    yVaultPrices = yVaultPrices.output;
    yCrvPrice = yCrvPrice.output;

    _.each(underlyingBalances, (underlying, i) => {
      if(underlying.success) {
        let balance = underlying.output;
        let address = underlyingAddress[i].output;
        let cAddress = underlying.input.target;
        balances[address] = balance;
        delete balances[cAddress];
      }
    })

    _.each(poolBalances, (balanceOf, i) => {
      if(balanceOf.success) {
        let balance = balanceOf.output;
        let address = balanceOf.input.target;
        let isCToken = isCTokens[i];

        if (BigNumber(balance).toNumber() <= 0) {
          return;
        }

        if (isCToken.success && isCToken.output && isCToken.input.target !== yETH) {
          return;
        }
        
        if (address === yETH) {
          const yETHCash = BigNumber(balance).multipliedBy(yVaultPrices[0].output).div(1e18).integerValue();
          balances[wETH] = BigNumber(balances[wETH] || 0).plus(yETHCash).toFixed();
          delete balances[yETH];
        } else if (address === yyCrv) {
          const yyCrvCash = BigNumber(balance).multipliedBy(yCrvPrice).div(1e18).div(1e12).multipliedBy(yVaultPrices[1].output).div(1e18).integerValue();
          balances[usdt] = BigNumber(balances[usdt] || 0).plus(yyCrvCash).toFixed();
          delete balances[yyCrv];
        } else {
          balances[address] = BigNumber(balances[address] || 0).plus(balance).toFixed();
        }
      }
    });
    return balances;
  }

/*==================================================
  Exports
  ==================================================*/

  module.exports = {
    name: 'C.R.E.A.M. Swap',
    website: 'https://cream.finance',
    token: null,
    category: 'dexes',
    start: 1599552000, // 09/08/2020 @ 8:00am (UTC)
    tvl
  }
