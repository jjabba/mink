/*jslint indent: 2, unparam: true, nomen: true, plusplus: true */
"use strict";
// temp to allow self signed HTTPS while debugging
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// import
var https, _, q, accountInfo, validate, throwIf, zlib, fs, stream, createHeader, oboe, getStreamDecoder, querystring;

https = require("https");
_ = require("underscore");
q = require("q");
zlib = require('zlib');
stream = require('stream');
oboe = require('oboe');

throwIf = {
  undefined : function (value) {
    if (value === undefined) {
      throw new TypeError("Value was undefined!");
    }
  },
  notObject: function (value) {
    if (!_.isObject(value)) {
      throw new TypeError("Expected Object, found " + typeof value);
    }
  },
  notString: function (value) {
    if (!_.isString(value)) {
      throw new TypeError("Expected String, found " + typeof value);
    }
  },
  notArray: function (value) {
    if (!_.isArray(value)) {
      throw new TypeError("Expected Array, found " + typeof value);
    }
  }
};

createHeader = function (contentLength) {
  var headers = {
    'Accept' : 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json; charset=UTF-8',
    'accept-encoding': "gzip, deflate",
    'accept-language': "en-US,en;q=0.8,sv;q=0.6",
    'cache-control': "no-cache",
    'user-agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.89 Safari/537.36"
  };
  if (contentLength !== undefined) {
    headers["Content-Length"] = contentLength;
  }
  return headers;
};

getStreamDecoder = function (encoding) {
  switch (encoding) {
  case 'gzip':
    return zlib.createGunzip();
  case 'deflate':
    return zlib.createInflate();
  default:
    return stream.PassThrough;
  }
};

validate = {

  options: function (options) {
    throwIf.notObject(options);
    return validate.tinkAccount(options.tinkAccount);
  },

  tinkAccount: function (tinkAccount) {
    throwIf.notObject(tinkAccount);
    return tinkAccount.hasOwnProperty("username") && tinkAccount.hasOwnProperty("password");
  },

  period: function (period) {
    return _.has(period, "clean")
      && _.has(period, "endDate")
      && _.has(period, "name")
      && _.has(period, "resolution")
      && _.has(period, "startDate");
  },

  periods: function (periods) {
    throwIf.notArray(periods);
    return periods.reduce(function (previousTest, periodToValidate) {
      return previousTest && validate.period(periodToValidate);
    }, true);
  }

};


module.exports = function (userOptions) {
  validate.options(userOptions);

  var service, mink;

  service = {
    // options
    options: _.extend({}, userOptions),

    // login
    loginData: null,

    // transactions
    periodDefers: {},

    // internal
    loginDefer: null,
    transactionDefer: null,

    /**
     * login -> sessionId
     */
    login: function () {

      if (service.loginDefer === null) {

        service.loginDefer = q.defer();

        var req, requestOptions, postData;

        postData = JSON.stringify(service.options.tinkAccount);

        // setup request
        requestOptions = {
          hostname: 'www.tinkapp.com',
          path: '/api/v1/user/login',
          method: 'POST',
          headers: createHeader(postData.length)
        };

        req = https.request(requestOptions, function (res) {

          var decoder = getStreamDecoder(res.headers['content-encoding']);

          res.pipe(decoder);

          oboe(decoder)
            .on('done', function (json) {
              service.loginData = json;
              service.loginDefer.resolve(service.loginData);
            })
            .on('fail', function (error) {
              service.loginDefer.reject("Oboe failed to parse json: " + error);
              service.loginDefer = null;
            });

          res.on('error', function (e) {
            service.loginDefer.reject("An error occurred parsing response: " + e.message);
            service.loginDefer = null;
          });

        }).on('error', function (e) {
          service.loginDefer.reject('An error occurred sending request: ' + e.message);
          service.loginDefer = null;
        });

        // write data to request body
        req.write(postData);
        req.end();
      }

      return service.loginDefer.promise;
    },

    /**
     * getValidPeriods -> [periods]
     */
    getPeriods: function (loginData) {
      return q.when(loginData.context.periods);
    },

    /**
     * getTransations -> period -> [Transactions]
     */
    getTransationsForPeriod: function (loginData, period) {
      if (service.periodDefers[period.name] === undefined) {
        var transationsDefer, requestOptions;

        transationsDefer = q.defer();
        service.periodDefers[period.name] = transationsDefer;

        // setup request
        requestOptions = {
          host: 'www.tinkapp.com',
          path: encodeURI('/api/v1/transactions?periods[]=' + period.name + '&limit=100&sort=DATE&order=DESC'),
          method: 'GET',
          headers: createHeader()
        };
        requestOptions.headers["X-Tink-Session-ID"] = loginData.sessionId;

        transationsDefer = q.defer();
        service.periodDefers[period.name] = transationsDefer;
        https.request(requestOptions, function (res) {

          var decoder = getStreamDecoder(res.headers['content-encoding']);
          res.pipe(decoder);

          oboe(decoder)
            .on('done', function (json) {
              transationsDefer.resolve(json);
            })
            .on('fail', function (error) {
              service.periodDefers[period] = null;
              transationsDefer.reject("Oboe failed to parse json: " + error);
            });
          res.on('error', function (e) {
            service.periodDefers[period] = null;
            transationsDefer.reject("An error occurred parsing response: " + e.message);
          });

        }).on('error', function (e) {
          service.periodDefers[period] = null;
          transationsDefer.reject('An error occurred sending request: ' + e.message);
        }).end();
      }

      return service.periodDefers[period.name].promise;
    }
  };

  mink = {

    getPeriods: function () {
      return service.login().then(service.getPeriods);
    },

    getTransactionsForPeriods: function (periods) {
      var transactionDefer = q.defer();

      validate.periods(periods);
      service.login()
        .then(function (loginData) {
          var requests = periods.map(function (period) {
            return service.getTransationsForPeriod(loginData, period);
          });
          return q.all(requests);
        })
        .then(function (transactions) {
          transactionDefer.resolve(transactions);
        })
        .catch(transactionDefer.reject);
      return transactionDefer.promise;
    },

    getTransationsForPeriod: function (period) {
      return service.login()
        .then(function (loginData) {
          return service.getTransationsForPeriod(loginData, period);
        });
    }

  };

  return mink;
};
