# Mink
A miner for the financial service tink.se. All calls return promises.

## usage
Import mink
    var mink = require('mink');
Create a miner (one miner per tink account is needed)
    miner = mink({ tinkAccount: {username: "tink@user.com", password: "mySecretPassword"}});
Now your miner is ready to be used

## API
    getPeriods() -> Promise([Period, ...])
    getTransactionsForPeriods([Period, ...]) -> Promise([[Transactions], [Transactions]])
