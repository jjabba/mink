/*jslint indent: 2, unparam: true, nomen: true, plusplus: true */
"use strict";

// import
var mink, miner, periods;

mink = require('mink');

miner = mink({ tinkAccount: {username: "tink@user.com", password: "mySecretPassword"}});

miner.getPeriods()
  .then(function (foundPeriods) {
    periods = foundPeriods;
    return miner.getTransactionsForPeriods(periods);
  }).then(function (transactions) {
    transactions.map(function (theseTransactions, index) {
      console.log("Retrieved " + theseTransactions.length + " for period " + periods[index].name);
    });
  })
  .catch(console.log);
