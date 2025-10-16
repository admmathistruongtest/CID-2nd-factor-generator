
    // ##########################################################
   // ###############     Progress ring     ####################
   // ##########################################################
   
   class ProgressRing extends HTMLElement {
  constructor() {
    super();
    const stroke = this.getAttribute('stroke');
    const radius = this.getAttribute('radius');
    const color = this.getAttribute('color');
    const normalizedRadius = radius - stroke * 2;
    this._circumference = normalizedRadius * 2 * Math.PI;

    this._root = this.attachShadow({mode: 'open'});
    this._root.innerHTML = `
      <svg
        height="${radius * 2}"
        width="${radius * 2}"
       >
         <circle
           stroke="${color}"
           stroke-dasharray="${this._circumference} ${this._circumference}"
           style="stroke-dashoffset:${this._circumference}"
           stroke-width="${stroke}"
           fill="transparent"
           r="${normalizedRadius}"
           cx="${radius}"
           cy="${radius}"
        />
      </svg>

      <style>
        circle {
          transition: stroke-dashoffset 0.35s;
          transform: rotate(-90deg);
          transform-origin: 50% 50%;
        }
      </style>
    `;
  }
  
  setProgress(percent) {
    const offset = this._circumference - (percent / 100 * this._circumference);
    const circle = this._root.querySelector('circle');
    circle.style.strokeDashoffset = offset; 
  }

  static get observedAttributes() {
    return ['progress'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'progress') {
      this.setProgress(newValue);
    }
  }
}


window.customElements.define('progress-ring', ProgressRing);

 // ############################################################################   
 // ###############         sha TOTP Authentication.        ####################
 // ############################################################################
  
    TOTP = function() {
  var dec2hex = function(s) {
    return (s < 15.5 ? "0" : "") + Math.round(s).toString(16);
  };
  
  var hex2dec = function(s) {
    return parseInt(s, 16);
  };
  
  var leftpad = function(s, l, p) {
    if(l + 1 >= s.length) {
      s = Array(l + 1 - s.length).join(p) + s;
    }
    return s;
  };
  
  var base32tohex = function(base32) {
    var base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    var bits = "";
    var hex = "";
    for(var i = 0; i < base32.length; i++) {
      var val = base32chars.indexOf(base32.charAt(i).toUpperCase());
      bits += leftpad(val.toString(2), 5, '0');
    }
    for(i = 0; i + 4 <= bits.length; i+=4) {
      var chunk = bits.substr(i, 4);
      hex = hex + parseInt(chunk, 2).toString(16) ;
    }
    return hex;
  };
  
  this.setSecret = function(secret){
    this.secret = secret;
  };
  
  this.left = function(){
  var epoch = (Date.now()/ 1000.0)+38;
  var rawCounter = (Math.floor(epoch / 30));
  return ((epoch/30) - rawCounter)*100
  };
  
  this.getNowCounter = function generateCounterForActiveTime(){
    //var epoch = Math.round(new Date().getTime() / 1000.0);
    var epoch = (Date.now()/ 1000.0)+38;
    //var rawCounter = (Math.floor(epoch / 30))+1;
    var rawCounter = (Math.floor(epoch / 30));
    this.counter = leftpad(dec2hex(rawCounter), 16, "0");
    return this.counter;
  };
  
  this.getOTP = function(counter) {
    var otp;
    try {
      if(counter !== undefined){
        counter = leftpad(dec2hex(counter), 16, "0");        
      }else{
        counter = this.getNowCounter();
      }
      var rev = hex2dec(counter);
      
      var hmacObj = new jsSHA("SHA-1", "HEX");
      hmacObj.setHMACKey(base32tohex(this.secret), "HEX");
      hmacObj.update(counter);
      var hmac = hmacObj.getHMAC("HEX");
      
      var offset = hex2dec(hmac.substring(hmac.length - 1));
      otp = (hex2dec(hmac.substr(offset * 2, 8)) & hex2dec("7fffffff")) + "";
      otp = (otp).substr(otp.length - 6, 6);
    } catch (error) {
      throw error;
    }
    return otp;
  };
  
  
  /**
  * Generates a key of a certain length (default 32) in base 32
  *
  * @param  {Integer} [length=32]  The length of the key.
  * @return {String} The generated key.
  */
  this.generateSecret = function generateSecretASCII (length) {
    var N = length || 32;
    var s = "234567ABCDEFGHIJKLMNOPQRSTUVWXTZ"; // base 32
    var secret = Array(N).join().split(',').map(function() { return s.charAt(Math.floor(Math.random() * s.length)); }).join('');
    this.secret = secret;
    return secret;
  };
  
  
  
  this.hotpVerifyDelta = function hotpVerifyDelta (token, counter) {
    // verify secret and token exist
    var secret = this.secret;
    
    if (secret === null || typeof secret === 'undefined') throw new Error('hotp.verifyDelta - Missing secret');
    if (token === null || typeof token === 'undefined') throw new Error('hotp.verifyDelta - Missing token');
    
    // parse token to integer
    token = token.toString();
    
    // fail if token is NA
    if (isNaN(token)) {
      return;
    }
    
    counter = counter || hex2dec(this.getNowCounter());
    
    // loop from C to C + W inclusive
    for (var i = (counter-1); i <= counter + 1; ++i) {
      // domain-specific constant-time comparison for integer codes
      var tempCounter = leftpad(dec2hex(i), 16, "0");
      var checkToken = this.getOTP(i);
      if (checkToken === token) {
        // found a matching code, return delta
        return {delta: i - counter};
      }
    }
    
    // no codes have matched
  };
  
};



function makeSecret(e){
  var totpObj = new TOTP();
  var secret = totpObj.generateSecret(e);
  var user = Session.getActiveUser().getEmail();
  var q = app.models.userAuthentication.newQuery();
  q.filters.users.email._equals =  user;
  var res = q.run();
  
  var userRecord;
  var userQ = app.models.users.newQuery();
  userQ.filters.email._equals = user;
  var users = userQ.run();
  userRecord = users[0];
  
  var rec;
  if(res.length === 0){
    rec = app.models.userAuthentication.newRecord();
    rec.users = userRecord;
    
    }
  else{
    rec = res[0];
    }
  
  rec.preferedMethod = "2FA";
  rec.totpSecret = secret;
  app.saveRecords([rec]);
  return secret;
}

function check2FA(userEmail, code){
      var totpObj = new TOTP();
    var q = app.models.userAuthentication.newQuery();
    q.filters.users.email._equals =  userEmail;
    var res = q.run();
    var secret = res[0].totpSecret;
    totpObj.setSecret(secret);
    var verif = totpObj.hotpVerifyDelta(code);
    return verif !== undefined;  
}



/*
 A JavaScript implementation of the SHA family of hashes, as
 defined in FIPS PUB 180-4 and FIPS PUB 202, as well as the corresponding
 HMAC implementation as defined in FIPS PUB 198a

 Copyright 2008-2018 Brian Turek, 1998-2009 Paul Johnston & Contributors
 Distributed under the BSD License
 See http://caligatio.github.com/jsSHA/ for more information
*/
var SUPPORTED_ALGS = 8 | 4 | 2 | 1;
(function(global) {
  var TWO_PWR_32 = 4294967296;
  function Int_64(msint_32, lsint_32) {
    this.highOrder = msint_32;
    this.lowOrder = lsint_32;
  }
  function str2packed(str, utfType, existingPacked, existingPackedLen, bigEndianMod) {
    var packed, codePnt, codePntArr, byteCnt = 0, i, j, existingByteLen, intOffset, byteOffset, shiftModifier, transposeBytes;
    packed = existingPacked || [0];
    existingPackedLen = existingPackedLen || 0;
    existingByteLen = existingPackedLen >>> 3;
    if ("UTF8" === utfType) {
      shiftModifier = bigEndianMod === -1 ? 3 : 0;
      for (i = 0; i < str.length; i += 1) {
        codePnt = str.charCodeAt(i);
        codePntArr = [];
        if (128 > codePnt) {
          codePntArr.push(codePnt);
        } else {
          if (2048 > codePnt) {
            codePntArr.push(192 | codePnt >>> 6);
            codePntArr.push(128 | codePnt & 63);
          } else {
            if (55296 > codePnt || 57344 <= codePnt) {
              codePntArr.push(224 | codePnt >>> 12, 128 | codePnt >>> 6 & 63, 128 | codePnt & 63);
            } else {
              i += 1;
              codePnt = 65536 + ((codePnt & 1023) << 10 | str.charCodeAt(i) & 1023);
              codePntArr.push(240 | codePnt >>> 18, 128 | codePnt >>> 12 & 63, 128 | codePnt >>> 6 & 63, 128 | codePnt & 63);
            }
          }
        }
        for (j = 0; j < codePntArr.length; j += 1) {
          byteOffset = byteCnt + existingByteLen;
          intOffset = byteOffset >>> 2;
          while (packed.length <= intOffset) {
            packed.push(0);
          }
          packed[intOffset] |= codePntArr[j] << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
          byteCnt += 1;
        }
      }
    } else {
      if ("UTF16BE" === utfType || "UTF16LE" === utfType) {
        shiftModifier = bigEndianMod === -1 ? 2 : 0;
        transposeBytes = "UTF16LE" === utfType && bigEndianMod !== 1 || "UTF16LE" !== utfType && bigEndianMod === 1;
        for (i = 0; i < str.length; i += 1) {
          codePnt = str.charCodeAt(i);
          if (transposeBytes === true) {
            j = codePnt & 255;
            codePnt = j << 8 | codePnt >>> 8;
          }
          byteOffset = byteCnt + existingByteLen;
          intOffset = byteOffset >>> 2;
          while (packed.length <= intOffset) {
            packed.push(0);
          }
          packed[intOffset] |= codePnt << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
          byteCnt += 2;
        }
      }
    }
    return {"value":packed, "binLen":byteCnt * 8 + existingPackedLen};
  }
  function hex2packed(str, existingPacked, existingPackedLen, bigEndianMod) {
    var packed, length = str.length, i, num, intOffset, byteOffset, existingByteLen, shiftModifier;
    if (0 !== length % 2) {
      throw new Error("String of HEX type must be in byte increments");
    }
    packed = existingPacked || [0];
    existingPackedLen = existingPackedLen || 0;
    existingByteLen = existingPackedLen >>> 3;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < length; i += 2) {
      num = parseInt(str.substr(i, 2), 16);
      if (!isNaN(num)) {
        byteOffset = (i >>> 1) + existingByteLen;
        intOffset = byteOffset >>> 2;
        while (packed.length <= intOffset) {
          packed.push(0);
        }
        packed[intOffset] |= num << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
      } else {
        throw new Error("String of HEX type contains invalid characters");
      }
    }
    return {"value":packed, "binLen":length * 4 + existingPackedLen};
  }
  function bytes2packed(str, existingPacked, existingPackedLen, bigEndianMod) {
    var packed, codePnt, i, existingByteLen, intOffset, byteOffset, shiftModifier;
    packed = existingPacked || [0];
    existingPackedLen = existingPackedLen || 0;
    existingByteLen = existingPackedLen >>> 3;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < str.length; i += 1) {
      codePnt = str.charCodeAt(i);
      byteOffset = i + existingByteLen;
      intOffset = byteOffset >>> 2;
      if (packed.length <= intOffset) {
        packed.push(0);
      }
      packed[intOffset] |= codePnt << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
    }
    return {"value":packed, "binLen":str.length * 8 + existingPackedLen};
  }
  function b642packed(str, existingPacked, existingPackedLen, bigEndianMod) {
    var packed, byteCnt = 0, index, i, j, tmpInt, strPart, firstEqual, b64Tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", existingByteLen, intOffset, byteOffset, shiftModifier;
    if (-1 === str.search(/^[a-zA-Z0-9=+\/]+$/)) {
      throw new Error("Invalid character in base-64 string");
    }
    firstEqual = str.indexOf("=");
    str = str.replace(/=/g, "");
    if (-1 !== firstEqual && firstEqual < str.length) {
      throw new Error("Invalid '=' found in base-64 string");
    }
    packed = existingPacked || [0];
    existingPackedLen = existingPackedLen || 0;
    existingByteLen = existingPackedLen >>> 3;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < str.length; i += 4) {
      strPart = str.substr(i, 4);
      tmpInt = 0;
      for (j = 0; j < strPart.length; j += 1) {
        index = b64Tab.indexOf(strPart[j]);
        tmpInt |= index << 18 - 6 * j;
      }
      for (j = 0; j < strPart.length - 1; j += 1) {
        byteOffset = byteCnt + existingByteLen;
        intOffset = byteOffset >>> 2;
        while (packed.length <= intOffset) {
          packed.push(0);
        }
        packed[intOffset] |= (tmpInt >>> 16 - j * 8 & 255) << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
        byteCnt += 1;
      }
    }
    return {"value":packed, "binLen":byteCnt * 8 + existingPackedLen};
  }
  function arraybuffer2packed(arr, existingPacked, existingPackedLen, bigEndianMod) {
    var packed, i, existingByteLen, intOffset, byteOffset, shiftModifier, arrView;
    packed = existingPacked || [0];
    existingPackedLen = existingPackedLen || 0;
    existingByteLen = existingPackedLen >>> 3;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    arrView = new Uint8Array(arr);
    for (i = 0; i < arr.byteLength; i += 1) {
      byteOffset = i + existingByteLen;
      intOffset = byteOffset >>> 2;
      if (packed.length <= intOffset) {
        packed.push(0);
      }
      packed[intOffset] |= arrView[i] << 8 * (shiftModifier + bigEndianMod * (byteOffset % 4));
    }
    return {"value":packed, "binLen":arr.byteLength * 8 + existingPackedLen};
  }
  function packed2hex(packed, outputLength, bigEndianMod, formatOpts) {
    var hex_tab = "0123456789abcdef", str = "", length = outputLength / 8, i, srcByte, shiftModifier;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < length; i += 1) {
      srcByte = packed[i >>> 2] >>> 8 * (shiftModifier + bigEndianMod * (i % 4));
      str += hex_tab.charAt(srcByte >>> 4 & 15) + hex_tab.charAt(srcByte & 15);
    }
    return formatOpts["outputUpper"] ? str.toUpperCase() : str;
  }
  function packed2b64(packed, outputLength, bigEndianMod, formatOpts) {
    var str = "", length = outputLength / 8, i, j, triplet, int1, int2, shiftModifier, b64Tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < length; i += 3) {
      int1 = i + 1 < length ? packed[i + 1 >>> 2] : 0;
      int2 = i + 2 < length ? packed[i + 2 >>> 2] : 0;
      triplet = (packed[i >>> 2] >>> 8 * (shiftModifier + bigEndianMod * (i % 4)) & 255) << 16 | (int1 >>> 8 * (shiftModifier + bigEndianMod * ((i + 1) % 4)) & 255) << 8 | int2 >>> 8 * (shiftModifier + bigEndianMod * ((i + 2) % 4)) & 255;
      for (j = 0; j < 4; j += 1) {
        if (i * 8 + j * 6 <= outputLength) {
          str += b64Tab.charAt(triplet >>> 6 * (3 - j) & 63);
        } else {
          str += formatOpts["b64Pad"];
        }
      }
    }
    return str;
  }
  function packed2bytes(packed, outputLength, bigEndianMod) {
    var str = "", length = outputLength / 8, i, srcByte, shiftModifier;
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < length; i += 1) {
      srcByte = packed[i >>> 2] >>> 8 * (shiftModifier + bigEndianMod * (i % 4)) & 255;
      str += String.fromCharCode(srcByte);
    }
    return str;
  }
  function packed2arraybuffer(packed, outputLength, bigEndianMod) {
    var length = outputLength / 8, i, retVal = new ArrayBuffer(length), shiftModifier, arrView;
    arrView = new Uint8Array(retVal);
    shiftModifier = bigEndianMod === -1 ? 3 : 0;
    for (i = 0; i < length; i += 1) {
      arrView[i] = packed[i >>> 2] >>> 8 * (shiftModifier + bigEndianMod * (i % 4)) & 255;
    }
    return retVal;
  }
  function getOutputOpts(options) {
    var retVal = {"outputUpper":false, "b64Pad":"=", "shakeLen":-1}, outputOptions;
    outputOptions = options || {};
    retVal["outputUpper"] = outputOptions["outputUpper"] || false;
    if (true === outputOptions.hasOwnProperty("b64Pad")) {
      retVal["b64Pad"] = outputOptions["b64Pad"];
    }
    if (true === outputOptions.hasOwnProperty("shakeLen") && (8 & SUPPORTED_ALGS) !== 0) {
      if (outputOptions["shakeLen"] % 8 !== 0) {
        throw new Error("shakeLen must be a multiple of 8");
      }
      retVal["shakeLen"] = outputOptions["shakeLen"];
    }
    if ("boolean" !== typeof retVal["outputUpper"]) {
      throw new Error("Invalid outputUpper formatting option");
    }
    if ("string" !== typeof retVal["b64Pad"]) {
      throw new Error("Invalid b64Pad formatting option");
    }
    return retVal;
  }
  function getStrConverter(format, utfType, bigEndianMod) {
    var retVal;
    switch(utfType) {
      case "UTF8":
      case "UTF16BE":
      case "UTF16LE":
        break;
      default:
        throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE");
    }
    switch(format) {
      case "HEX":
        retVal = function(str, existingBin, existingBinLen) {
          return hex2packed(str, existingBin, existingBinLen, bigEndianMod);
        };
        break;
      case "TEXT":
        retVal = function(str, existingBin, existingBinLen) {
          return str2packed(str, utfType, existingBin, existingBinLen, bigEndianMod);
        };
        break;
      case "B64":
        retVal = function(str, existingBin, existingBinLen) {
          return b642packed(str, existingBin, existingBinLen, bigEndianMod);
        };
        break;
      case "BYTES":
        retVal = function(str, existingBin, existingBinLen) {
          return bytes2packed(str, existingBin, existingBinLen, bigEndianMod);
        };
        break;
      case "ARRAYBUFFER":
        try {
          retVal = new ArrayBuffer(0);
        } catch (ignore) {
          throw new Error("ARRAYBUFFER not supported by this environment");
        }
        retVal = function(arr, existingBin, existingBinLen) {
          return arraybuffer2packed(arr, existingBin, existingBinLen, bigEndianMod);
        };
        break;
      default:
        throw new Error("format must be HEX, TEXT, B64, BYTES, or ARRAYBUFFER");
    }
    return retVal;
  }
  function rotl_32(x, n) {
    return x << n | x >>> 32 - n;
  }
  function rotl_64(x, n) {
    if (n > 32) {
      n = n - 32;
      return new Int_64(x.lowOrder << n | x.highOrder >>> 32 - n, x.highOrder << n | x.lowOrder >>> 32 - n);
    } else {
      if (0 !== n) {
        return new Int_64(x.highOrder << n | x.lowOrder >>> 32 - n, x.lowOrder << n | x.highOrder >>> 32 - n);
      } else {
        return x;
      }
    }
  }
  function rotr_32(x, n) {
    return x >>> n | x << 32 - n;
  }
  function rotr_64(x, n) {
    var retVal = null, tmp = new Int_64(x.highOrder, x.lowOrder);
    if (32 >= n) {
      retVal = new Int_64(tmp.highOrder >>> n | tmp.lowOrder << 32 - n & 4294967295, tmp.lowOrder >>> n | tmp.highOrder << 32 - n & 4294967295);
    } else {
      retVal = new Int_64(tmp.lowOrder >>> n - 32 | tmp.highOrder << 64 - n & 4294967295, tmp.highOrder >>> n - 32 | tmp.lowOrder << 64 - n & 4294967295);
    }
    return retVal;
  }
  function shr_32(x, n) {
    return x >>> n;
  }
  function shr_64(x, n) {
    var retVal = null;
    if (32 >= n) {
      retVal = new Int_64(x.highOrder >>> n, x.lowOrder >>> n | x.highOrder << 32 - n & 4294967295);
    } else {
      retVal = new Int_64(0, x.highOrder >>> n - 32);
    }
    return retVal;
  }
  function parity_32(x, y, z) {
    return x ^ y ^ z;
  }
  function ch_32(x, y, z) {
    return x & y ^ ~x & z;
  }
  function ch_64(x, y, z) {
    return new Int_64(x.highOrder & y.highOrder ^ ~x.highOrder & z.highOrder, x.lowOrder & y.lowOrder ^ ~x.lowOrder & z.lowOrder);
  }
  function maj_32(x, y, z) {
    return x & y ^ x & z ^ y & z;
  }
  function maj_64(x, y, z) {
    return new Int_64(x.highOrder & y.highOrder ^ x.highOrder & z.highOrder ^ y.highOrder & z.highOrder, x.lowOrder & y.lowOrder ^ x.lowOrder & z.lowOrder ^ y.lowOrder & z.lowOrder);
  }
  function sigma0_32(x) {
    return rotr_32(x, 2) ^ rotr_32(x, 13) ^ rotr_32(x, 22);
  }
  function sigma0_64(x) {
    var rotr28 = rotr_64(x, 28), rotr34 = rotr_64(x, 34), rotr39 = rotr_64(x, 39);
    return new Int_64(rotr28.highOrder ^ rotr34.highOrder ^ rotr39.highOrder, rotr28.lowOrder ^ rotr34.lowOrder ^ rotr39.lowOrder);
  }
  function sigma1_32(x) {
    return rotr_32(x, 6) ^ rotr_32(x, 11) ^ rotr_32(x, 25);
  }
  function sigma1_64(x) {
    var rotr14 = rotr_64(x, 14), rotr18 = rotr_64(x, 18), rotr41 = rotr_64(x, 41);
    return new Int_64(rotr14.highOrder ^ rotr18.highOrder ^ rotr41.highOrder, rotr14.lowOrder ^ rotr18.lowOrder ^ rotr41.lowOrder);
  }
  function gamma0_32(x) {
    return rotr_32(x, 7) ^ rotr_32(x, 18) ^ shr_32(x, 3);
  }
  function gamma0_64(x) {
    var rotr1 = rotr_64(x, 1), rotr8 = rotr_64(x, 8), shr7 = shr_64(x, 7);
    return new Int_64(rotr1.highOrder ^ rotr8.highOrder ^ shr7.highOrder, rotr1.lowOrder ^ rotr8.lowOrder ^ shr7.lowOrder);
  }
  function gamma1_32(x) {
    return rotr_32(x, 17) ^ rotr_32(x, 19) ^ shr_32(x, 10);
  }
  function gamma1_64(x) {
    var rotr19 = rotr_64(x, 19), rotr61 = rotr_64(x, 61), shr6 = shr_64(x, 6);
    return new Int_64(rotr19.highOrder ^ rotr61.highOrder ^ shr6.highOrder, rotr19.lowOrder ^ rotr61.lowOrder ^ shr6.lowOrder);
  }
  function safeAdd_32_2(a, b) {
    var lsw = (a & 65535) + (b & 65535), msw = (a >>> 16) + (b >>> 16) + (lsw >>> 16);
    return (msw & 65535) << 16 | lsw & 65535;
  }
  function safeAdd_32_4(a, b, c, d) {
    var lsw = (a & 65535) + (b & 65535) + (c & 65535) + (d & 65535), msw = (a >>> 16) + (b >>> 16) + (c >>> 16) + (d >>> 16) + (lsw >>> 16);
    return (msw & 65535) << 16 | lsw & 65535;
  }
  function safeAdd_32_5(a, b, c, d, e) {
    var lsw = (a & 65535) + (b & 65535) + (c & 65535) + (d & 65535) + (e & 65535), msw = (a >>> 16) + (b >>> 16) + (c >>> 16) + (d >>> 16) + (e >>> 16) + (lsw >>> 16);
    return (msw & 65535) << 16 | lsw & 65535;
  }
  function safeAdd_64_2(x, y) {
    var lsw, msw, lowOrder, highOrder;
    lsw = (x.lowOrder & 65535) + (y.lowOrder & 65535);
    msw = (x.lowOrder >>> 16) + (y.lowOrder >>> 16) + (lsw >>> 16);
    lowOrder = (msw & 65535) << 16 | lsw & 65535;
    lsw = (x.highOrder & 65535) + (y.highOrder & 65535) + (msw >>> 16);
    msw = (x.highOrder >>> 16) + (y.highOrder >>> 16) + (lsw >>> 16);
    highOrder = (msw & 65535) << 16 | lsw & 65535;
    return new Int_64(highOrder, lowOrder);
  }
  function safeAdd_64_4(a, b, c, d) {
    var lsw, msw, lowOrder, highOrder;
    lsw = (a.lowOrder & 65535) + (b.lowOrder & 65535) + (c.lowOrder & 65535) + (d.lowOrder & 65535);
    msw = (a.lowOrder >>> 16) + (b.lowOrder >>> 16) + (c.lowOrder >>> 16) + (d.lowOrder >>> 16) + (lsw >>> 16);
    lowOrder = (msw & 65535) << 16 | lsw & 65535;
    lsw = (a.highOrder & 65535) + (b.highOrder & 65535) + (c.highOrder & 65535) + (d.highOrder & 65535) + (msw >>> 16);
    msw = (a.highOrder >>> 16) + (b.highOrder >>> 16) + (c.highOrder >>> 16) + (d.highOrder >>> 16) + (lsw >>> 16);
    highOrder = (msw & 65535) << 16 | lsw & 65535;
    return new Int_64(highOrder, lowOrder);
  }
  function safeAdd_64_5(a, b, c, d, e) {
    var lsw, msw, lowOrder, highOrder;
    lsw = (a.lowOrder & 65535) + (b.lowOrder & 65535) + (c.lowOrder & 65535) + (d.lowOrder & 65535) + (e.lowOrder & 65535);
    msw = (a.lowOrder >>> 16) + (b.lowOrder >>> 16) + (c.lowOrder >>> 16) + (d.lowOrder >>> 16) + (e.lowOrder >>> 16) + (lsw >>> 16);
    lowOrder = (msw & 65535) << 16 | lsw & 65535;
    lsw = (a.highOrder & 65535) + (b.highOrder & 65535) + (c.highOrder & 65535) + (d.highOrder & 65535) + (e.highOrder & 65535) + (msw >>> 16);
    msw = (a.highOrder >>> 16) + (b.highOrder >>> 16) + (c.highOrder >>> 16) + (d.highOrder >>> 16) + (e.highOrder >>> 16) + (lsw >>> 16);
    highOrder = (msw & 65535) << 16 | lsw & 65535;
    return new Int_64(highOrder, lowOrder);
  }
  function xor_64_2(a, b) {
    return new Int_64(a.highOrder ^ b.highOrder, a.lowOrder ^ b.lowOrder);
  }
  function xor_64_5(a, b, c, d, e) {
    return new Int_64(a.highOrder ^ b.highOrder ^ c.highOrder ^ d.highOrder ^ e.highOrder, a.lowOrder ^ b.lowOrder ^ c.lowOrder ^ d.lowOrder ^ e.lowOrder);
  }
  function cloneSHA3State(state) {
    var clone = [], i;
    for (i = 0; i < 5; i += 1) {
      clone[i] = state[i].slice();
    }
    return clone;
  }
  function getNewState(variant) {
    var retVal = [], H_trunc, H_full, i;
    if ("SHA-1" === variant && (1 & SUPPORTED_ALGS) !== 0) {
      retVal = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
    } else {
      if (variant.lastIndexOf("SHA-", 0) === 0 && (6 & SUPPORTED_ALGS) !== 0) {
        H_trunc = [3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025, 1694076839, 3204075428];
        H_full = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
        switch(variant) {
          case "SHA-224":
            retVal = H_trunc;
            break;
          case "SHA-256":
            retVal = H_full;
            break;
          case "SHA-384":
            retVal = [new Int_64(3418070365, H_trunc[0]), new Int_64(1654270250, H_trunc[1]), new Int_64(2438529370, H_trunc[2]), new Int_64(355462360, H_trunc[3]), new Int_64(1731405415, H_trunc[4]), new Int_64(41048885895, H_trunc[5]), new Int_64(3675008525, H_trunc[6]), new Int_64(1203062813, H_trunc[7])];
            break;
          case "SHA-512":
            retVal = [new Int_64(H_full[0], 4089235720), new Int_64(H_full[1], 2227873595), new Int_64(H_full[2], 4271175723), new Int_64(H_full[3], 1595750129), new Int_64(H_full[4], 2917565137), new Int_64(H_full[5], 725511199), new Int_64(H_full[6], 4215389547), new Int_64(H_full[7], 327033209)];
            break;
          default:
            throw new Error("Unknown SHA variant");
        }
      } else {
        if ((variant.lastIndexOf("SHA3-", 0) === 0 || variant.lastIndexOf("SHAKE", 0) === 0) && (8 & SUPPORTED_ALGS) !== 0) {
          for (i = 0; i < 5; i += 1) {
            retVal[i] = [new Int_64(0, 0), new Int_64(0, 0), new Int_64(0, 0), new Int_64(0, 0), new Int_64(0, 0)];
          }
        } else {
          throw new Error("No SHA variants supported");
        }
      }
    }
    return retVal;
  }
  function roundSHA1(block, H) {
    var W = [], a, b, c, d, e, T, ch = ch_32, parity = parity_32, maj = maj_32, rotl = rotl_32, safeAdd_2 = safeAdd_32_2, t, safeAdd_5 = safeAdd_32_5;
    a = H[0];
    b = H[1];
    c = H[2];
    d = H[3];
    e = H[4];
    for (t = 0; t < 80; t += 1) {
      if (t < 16) {
        W[t] = block[t];
      } else {
        W[t] = rotl(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);
      }
      if (t < 20) {
        T = safeAdd_5(rotl(a, 5), ch(b, c, d), e, 1518500249, W[t]);
      } else {
        if (t < 40) {
          T = safeAdd_5(rotl(a, 5), parity(b, c, d), e, 1859775393, W[t]);
        } else {
          if (t < 60) {
            T = safeAdd_5(rotl(a, 5), maj(b, c, d), e, 2400959708, W[t]);
          } else {
            T = safeAdd_5(rotl(a, 5), parity(b, c, d), e, 3395469782, W[t]);
          }
        }
      }
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = T;
    }
    H[0] = safeAdd_2(a, H[0]);
    H[1] = safeAdd_2(b, H[1]);
    H[2] = safeAdd_2(c, H[2]);
    H[3] = safeAdd_2(d, H[3]);
    H[4] = safeAdd_2(e, H[4]);
    return H;
  }
  function finalizeSHA1(remainder, remainderBinLen, processedBinLen, H, outputLen) {
    var i, appendedMessageLength, offset, totalLen;
    offset = (remainderBinLen + 65 >>> 9 << 4) + 15;
    while (remainder.length <= offset) {
      remainder.push(0);
    }
    remainder[remainderBinLen >>> 5] |= 128 << 24 - remainderBinLen % 32;
    totalLen = remainderBinLen + processedBinLen;
    remainder[offset] = totalLen & 4294967295;
    remainder[offset - 1] = totalLen / TWO_PWR_32 | 0;
    appendedMessageLength = remainder.length;
    for (i = 0; i < appendedMessageLength; i += 16) {
      H = roundSHA1(remainder.slice(i, i + 16), H);
    }
    return H;
  }
  var K_sha2, K_sha512, r_sha3, rc_sha3;
  if ((6 & SUPPORTED_ALGS) !== 0) {
    K_sha2 = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 
    3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
    if ((4 & SUPPORTED_ALGS) !== 0) {
      K_sha512 = [new Int_64(K_sha2[0], 3609767458), new Int_64(K_sha2[1], 602891725), new Int_64(K_sha2[2], 3964484399), new Int_64(K_sha2[3], 2173295548), new Int_64(K_sha2[4], 4081628472), new Int_64(K_sha2[5], 3053834265), new Int_64(K_sha2[6], 2937671579), new Int_64(K_sha2[7], 3664609560), new Int_64(K_sha2[8], 2734883394), new Int_64(K_sha2[9], 1164996542), new Int_64(K_sha2[10], 1323610764), new Int_64(K_sha2[11], 3590304994), new Int_64(K_sha2[12], 4068182383), new Int_64(K_sha2[13], 991336113), 
      new Int_64(K_sha2[14], 633803317), new Int_64(K_sha2[15], 3479774868), new Int_64(K_sha2[16], 2666613458), new Int_64(K_sha2[17], 944711139), new Int_64(K_sha2[18], 2341262773), new Int_64(K_sha2[19], 2007800933), new Int_64(K_sha2[20], 1495990901), new Int_64(K_sha2[21], 1856431235), new Int_64(K_sha2[22], 3175218132), new Int_64(K_sha2[23], 2198950837), new Int_64(K_sha2[24], 3999719339), new Int_64(K_sha2[25], 766784016), new Int_64(K_sha2[26], 2566594879), new Int_64(K_sha2[27], 3203337956), 
      new Int_64(K_sha2[28], 1034457026), new Int_64(K_sha2[29], 2466948901), new Int_64(K_sha2[30], 3758326383), new Int_64(K_sha2[31], 168717936), new Int_64(K_sha2[32], 1188179964), new Int_64(K_sha2[33], 1546045734), new Int_64(K_sha2[34], 1522805485), new Int_64(K_sha2[35], 2643833823), new Int_64(K_sha2[36], 2343527390), new Int_64(K_sha2[37], 1014477480), new Int_64(K_sha2[38], 1206759142), new Int_64(K_sha2[39], 344077627), new Int_64(K_sha2[40], 1290863460), new Int_64(K_sha2[41], 3158454273), 
      new Int_64(K_sha2[42], 3505952657), new Int_64(K_sha2[43], 106217008), new Int_64(K_sha2[44], 3606008344), new Int_64(K_sha2[45], 1432725776), new Int_64(K_sha2[46], 1467031594), new Int_64(K_sha2[47], 851169720), new Int_64(K_sha2[48], 3100823752), new Int_64(K_sha2[49], 1363258195), new Int_64(K_sha2[50], 3750685593), new Int_64(K_sha2[51], 3785050280), new Int_64(K_sha2[52], 3318307427), new Int_64(K_sha2[53], 3812723403), new Int_64(K_sha2[54], 2003034995), new Int_64(K_sha2[55], 3602036899), 
      new Int_64(K_sha2[56], 1575990012), new Int_64(K_sha2[57], 1125592928), new Int_64(K_sha2[58], 2716904306), new Int_64(K_sha2[59], 442776044), new Int_64(K_sha2[60], 593698344), new Int_64(K_sha2[61], 3733110249), new Int_64(K_sha2[62], 2999351573), new Int_64(K_sha2[63], 3815920427), new Int_64(3391569614, 3928383900), new Int_64(3515267271, 566280711), new Int_64(3940187606, 3454069534), new Int_64(4118630271, 4000239992), new Int_64(116418474, 1914138554), new Int_64(174292421, 2731055270), 
      new Int_64(289380356, 3203993006), new Int_64(460393269, 320620315), new Int_64(685471733, 587496836), new Int_64(852142971, 1086792851), new Int_64(1017036298, 365543100), new Int_64(1126000580, 2618297676), new Int_64(1288033470, 3409855158), new Int_64(1501505948, 4234509866), new Int_64(1607167915, 987167468), new Int_64(1816402316, 1246189591)];
    }
  }
  if ((8 & SUPPORTED_ALGS) !== 0) {
    rc_sha3 = [new Int_64(0, 1), new Int_64(0, 32898), new Int_64(2147483648, 32906), new Int_64(2147483648, 2147516416), new Int_64(0, 32907), new Int_64(0, 2147483649), new Int_64(2147483648, 2147516545), new Int_64(2147483648, 32777), new Int_64(0, 138), new Int_64(0, 136), new Int_64(0, 2147516425), new Int_64(0, 2147483658), new Int_64(0, 2147516555), new Int_64(2147483648, 139), new Int_64(2147483648, 32905), new Int_64(2147483648, 32771), new Int_64(2147483648, 32770), new Int_64(2147483648, 
    128), new Int_64(0, 32778), new Int_64(2147483648, 2147483658), new Int_64(2147483648, 2147516545), new Int_64(2147483648, 32896), new Int_64(0, 2147483649), new Int_64(2147483648, 2147516424)];
    r_sha3 = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  }
  function roundSHA2(block, H, variant) {
    var a, b, c, d, e, f, g, h, T1, T2, numRounds, t, binaryStringMult, safeAdd_2, safeAdd_4, safeAdd_5, gamma0, gamma1, sigma0, sigma1, ch, maj, Int, W = [], int1, int2, offset, K;
    if ((variant === "SHA-224" || variant === "SHA-256") && (2 & SUPPORTED_ALGS) !== 0) {
      numRounds = 64;
      binaryStringMult = 1;
      Int = Number;
      safeAdd_2 = safeAdd_32_2;
      safeAdd_4 = safeAdd_32_4;
      safeAdd_5 = safeAdd_32_5;
      gamma0 = gamma0_32;
      gamma1 = gamma1_32;
      sigma0 = sigma0_32;
      sigma1 = sigma1_32;
      maj = maj_32;
      ch = ch_32;
      K = K_sha2;
    } else {
      if ((variant === "SHA-384" || variant === "SHA-512") && (4 & SUPPORTED_ALGS) !== 0) {
        numRounds = 80;
        binaryStringMult = 2;
        Int = Int_64;
        safeAdd_2 = safeAdd_64_2;
        safeAdd_4 = safeAdd_64_4;
        safeAdd_5 = safeAdd_64_5;
        gamma0 = gamma0_64;
        gamma1 = gamma1_64;
        sigma0 = sigma0_64;
        sigma1 = sigma1_64;
        maj = maj_64;
        ch = ch_64;
        K = K_sha512;
      } else {
        throw new Error("Unexpected error in SHA-2 implementation");
      }
    }
    a = H[0];
    b = H[1];
    c = H[2];
    d = H[3];
    e = H[4];
    f = H[5];
    g = H[6];
    h = H[7];
    for (t = 0; t < numRounds; t += 1) {
      if (t < 16) {
        offset = t * binaryStringMult;
        int1 = block.length <= offset ? 0 : block[offset];
        int2 = block.length <= offset + 1 ? 0 : block[offset + 1];
        W[t] = new Int(int1, int2);
      } else {
        W[t] = safeAdd_4(gamma1(W[t - 2]), W[t - 7], gamma0(W[t - 15]), W[t - 16]);
      }
      T1 = safeAdd_5(h, sigma1(e), ch(e, f, g), K[t], W[t]);
      T2 = safeAdd_2(sigma0(a), maj(a, b, c));
      h = g;
      g = f;
      f = e;
      e = safeAdd_2(d, T1);
      d = c;
      c = b;
      b = a;
      a = safeAdd_2(T1, T2);
    }
    H[0] = safeAdd_2(a, H[0]);
    H[1] = safeAdd_2(b, H[1]);
    H[2] = safeAdd_2(c, H[2]);
    H[3] = safeAdd_2(d, H[3]);
    H[4] = safeAdd_2(e, H[4]);
    H[5] = safeAdd_2(f, H[5]);
    H[6] = safeAdd_2(g, H[6]);
    H[7] = safeAdd_2(h, H[7]);
    return H;
  }
  function finalizeSHA2(remainder, remainderBinLen, processedBinLen, H, variant, outputLen) {
    var i, appendedMessageLength, offset, retVal, binaryStringInc, totalLen;
    if ((variant === "SHA-224" || variant === "SHA-256") && (2 & SUPPORTED_ALGS) !== 0) {
      offset = (remainderBinLen + 65 >>> 9 << 4) + 15;
      binaryStringInc = 16;
    } else {
      if ((variant === "SHA-384" || variant === "SHA-512") && (4 & SUPPORTED_ALGS) !== 0) {
        offset = (remainderBinLen + 129 >>> 10 << 5) + 31;
        binaryStringInc = 32;
      } else {
        throw new Error("Unexpected error in SHA-2 implementation");
      }
    }
    while (remainder.length <= offset) {
      remainder.push(0);
    }
    remainder[remainderBinLen >>> 5] |= 128 << 24 - remainderBinLen % 32;
    totalLen = remainderBinLen + processedBinLen;
    remainder[offset] = totalLen & 4294967295;
    remainder[offset - 1] = totalLen / TWO_PWR_32 | 0;
    appendedMessageLength = remainder.length;
    for (i = 0; i < appendedMessageLength; i += binaryStringInc) {
      H = roundSHA2(remainder.slice(i, i + binaryStringInc), H, variant);
    }
    if ("SHA-224" === variant && (2 & SUPPORTED_ALGS) !== 0) {
      retVal = [H[0], H[1], H[2], H[3], H[4], H[5], H[6]];
    } else {
      if ("SHA-256" === variant && (2 & SUPPORTED_ALGS) !== 0) {
        retVal = H;
      } else {
        if ("SHA-384" === variant && (4 & SUPPORTED_ALGS) !== 0) {
          retVal = [H[0].highOrder, H[0].lowOrder, H[1].highOrder, H[1].lowOrder, H[2].highOrder, H[2].lowOrder, H[3].highOrder, H[3].lowOrder, H[4].highOrder, H[4].lowOrder, H[5].highOrder, H[5].lowOrder];
        } else {
          if ("SHA-512" === variant && (4 & SUPPORTED_ALGS) !== 0) {
            retVal = [H[0].highOrder, H[0].lowOrder, H[1].highOrder, H[1].lowOrder, H[2].highOrder, H[2].lowOrder, H[3].highOrder, H[3].lowOrder, H[4].highOrder, H[4].lowOrder, H[5].highOrder, H[5].lowOrder, H[6].highOrder, H[6].lowOrder, H[7].highOrder, H[7].lowOrder];
          } else {
            throw new Error("Unexpected error in SHA-2 implementation");
          }
        }
      }
    }
    return retVal;
  }
  function roundSHA3(block, state) {
    var round, x, y, B, C = [], D = [];
    if (null !== block) {
      for (x = 0; x < block.length; x += 2) {
        state[(x >>> 1) % 5][(x >>> 1) / 5 | 0] = xor_64_2(state[(x >>> 1) % 5][(x >>> 1) / 5 | 0], new Int_64(block[x + 1], block[x]));
      }
    }
    for (round = 0; round < 24; round += 1) {
      B = getNewState("SHA3-");
      for (x = 0; x < 5; x += 1) {
        C[x] = xor_64_5(state[x][0], state[x][1], state[x][2], state[x][3], state[x][4]);
      }
      for (x = 0; x < 5; x += 1) {
        D[x] = xor_64_2(C[(x + 4) % 5], rotl_64(C[(x + 1) % 5], 1));
      }
      for (x = 0; x < 5; x += 1) {
        for (y = 0; y < 5; y += 1) {
          state[x][y] = xor_64_2(state[x][y], D[x]);
        }
      }
      for (x = 0; x < 5; x += 1) {
        for (y = 0; y < 5; y += 1) {
          B[y][(2 * x + 3 * y) % 5] = rotl_64(state[x][y], r_sha3[x][y]);
        }
      }
      for (x = 0; x < 5; x += 1) {
        for (y = 0; y < 5; y += 1) {
          state[x][y] = xor_64_2(B[x][y], new Int_64(~B[(x + 1) % 5][y].highOrder & B[(x + 2) % 5][y].highOrder, ~B[(x + 1) % 5][y].lowOrder & B[(x + 2) % 5][y].lowOrder));
        }
      }
      state[0][0] = xor_64_2(state[0][0], rc_sha3[round]);
    }
    return state;
  }
  function finalizeSHA3(remainder, remainderBinLen, processedBinLen, state, blockSize, delimiter, outputLen) {
    var i, retVal = [], binaryStringInc = blockSize >>> 5, state_offset = 0, remainderIntLen = remainderBinLen >>> 5, temp;
    for (i = 0; i < remainderIntLen && remainderBinLen >= blockSize; i += binaryStringInc) {
      state = roundSHA3(remainder.slice(i, i + binaryStringInc), state);
      remainderBinLen -= blockSize;
    }
    remainder = remainder.slice(i);
    remainderBinLen = remainderBinLen % blockSize;
    while (remainder.length < binaryStringInc) {
      remainder.push(0);
    }
    i = remainderBinLen >>> 3;
    remainder[i >> 2] ^= delimiter << 8 * (i % 4);
    remainder[binaryStringInc - 1] ^= 2147483648;
    state = roundSHA3(remainder, state);
    while (retVal.length * 32 < outputLen) {
      temp = state[state_offset % 5][state_offset / 5 | 0];
      retVal.push(temp.lowOrder);
      if (retVal.length * 32 >= outputLen) {
        break;
      }
      retVal.push(temp.highOrder);
      state_offset += 1;
      if (0 === state_offset * 64 % blockSize) {
        roundSHA3(null, state);
      }
    }
    return retVal;
  }
  var jsSHA = function(variant, inputFormat, options) {
    var processedLen = 0, remainder = [], remainderLen = 0, utfType, intermediateState, converterFunc, shaVariant = variant, outputBinLen, variantBlockSize, roundFunc, finalizeFunc, stateCloneFunc, hmacKeySet = false, keyWithIPad = [], keyWithOPad = [], numRounds, updatedCalled = false, inputOptions, isSHAKE = false, bigEndianMod = -1;
    inputOptions = options || {};
    utfType = inputOptions["encoding"] || "UTF8";
    numRounds = inputOptions["numRounds"] || 1;
    if (numRounds !== parseInt(numRounds, 10) || 1 > numRounds) {
      throw new Error("numRounds must a integer >= 1");
    }
    if ("SHA-1" === shaVariant && (1 & SUPPORTED_ALGS) !== 0) {
      variantBlockSize = 512;
      roundFunc = roundSHA1;
      finalizeFunc = finalizeSHA1;
      outputBinLen = 160;
      stateCloneFunc = function(state) {
        return state.slice();
      };
    } else {
      if (shaVariant.lastIndexOf("SHA-", 0) === 0 && (6 & SUPPORTED_ALGS) !== 0) {
        roundFunc = function(block, H) {
          return roundSHA2(block, H, shaVariant);
        };
        finalizeFunc = function(remainder, remainderBinLen, processedBinLen, H, outputLen) {
          return finalizeSHA2(remainder, remainderBinLen, processedBinLen, H, shaVariant, outputLen);
        };
        stateCloneFunc = function(state) {
          return state.slice();
        };
        if ("SHA-224" === shaVariant && (2 & SUPPORTED_ALGS) !== 0) {
          variantBlockSize = 512;
          outputBinLen = 224;
        } else {
          if ("SHA-256" === shaVariant && (2 & SUPPORTED_ALGS) !== 0) {
            variantBlockSize = 512;
            outputBinLen = 256;
          } else {
            if ("SHA-384" === shaVariant && (4 & SUPPORTED_ALGS) !== 0) {
              variantBlockSize = 1024;
              outputBinLen = 384;
            } else {
              if ("SHA-512" === shaVariant && (4 & SUPPORTED_ALGS) !== 0) {
                variantBlockSize = 1024;
                outputBinLen = 512;
              } else {
                throw new Error("Chosen SHA variant is not supported");
              }
            }
          }
        }
      } else {
        if ((shaVariant.lastIndexOf("SHA3-", 0) === 0 || shaVariant.lastIndexOf("SHAKE", 0) === 0) && (8 & SUPPORTED_ALGS) !== 0) {
          var delimiter = 6;
          roundFunc = roundSHA3;
          stateCloneFunc = function(state) {
            return cloneSHA3State(state);
          };
          bigEndianMod = 1;
          if ("SHA3-224" === shaVariant) {
            variantBlockSize = 1152;
            outputBinLen = 224;
          } else {
            if ("SHA3-256" === shaVariant) {
              variantBlockSize = 1088;
              outputBinLen = 256;
            } else {
              if ("SHA3-384" === shaVariant) {
                variantBlockSize = 832;
                outputBinLen = 384;
              } else {
                if ("SHA3-512" === shaVariant) {
                  variantBlockSize = 576;
                  outputBinLen = 512;
                } else {
                  if ("SHAKE128" === shaVariant) {
                    variantBlockSize = 1344;
                    outputBinLen = -1;
                    delimiter = 31;
                    isSHAKE = true;
                  } else {
                    if ("SHAKE256" === shaVariant) {
                      variantBlockSize = 1088;
                      outputBinLen = -1;
                      delimiter = 31;
                      isSHAKE = true;
                    } else {
                      throw new Error("Chosen SHA variant is not supported");
                    }
                  }
                }
              }
            }
          }
          finalizeFunc = function(remainder, remainderBinLen, processedBinLen, state, outputLen) {
            return finalizeSHA3(remainder, remainderBinLen, processedBinLen, state, variantBlockSize, delimiter, outputLen);
          };
        } else {
          throw new Error("Chosen SHA variant is not supported");
        }
      }
    }
    converterFunc = getStrConverter(inputFormat, utfType, bigEndianMod);
    intermediateState = getNewState(shaVariant);
    this.setHMACKey = function(key, inputFormat, options) {
      var keyConverterFunc, convertRet, keyBinLen, keyToUse, blockByteSize, i, lastArrayIndex, keyOptions;
      if (true === hmacKeySet) {
        throw new Error("HMAC key already set");
      }
      if (true === updatedCalled) {
        throw new Error("Cannot set HMAC key after calling update");
      }
      if (isSHAKE === true && (8 & SUPPORTED_ALGS) !== 0) {
        throw new Error("SHAKE is not supported for HMAC");
      }
      keyOptions = options || {};
      utfType = keyOptions["encoding"] || "UTF8";
      keyConverterFunc = getStrConverter(inputFormat, utfType, bigEndianMod);
      convertRet = keyConverterFunc(key);
      keyBinLen = convertRet["binLen"];
      keyToUse = convertRet["value"];
      blockByteSize = variantBlockSize >>> 3;
      lastArrayIndex = blockByteSize / 4 - 1;
      if (blockByteSize < keyBinLen / 8) {
        keyToUse = finalizeFunc(keyToUse, keyBinLen, 0, getNewState(shaVariant), outputBinLen);
        while (keyToUse.length <= lastArrayIndex) {
          keyToUse.push(0);
        }
        keyToUse[lastArrayIndex] &= 4294967040;
      } else {
        if (blockByteSize > keyBinLen / 8) {
          while (keyToUse.length <= lastArrayIndex) {
            keyToUse.push(0);
          }
          keyToUse[lastArrayIndex] &= 4294967040;
        }
      }
      for (i = 0; i <= lastArrayIndex; i += 1) {
        keyWithIPad[i] = keyToUse[i] ^ 909522486;
        keyWithOPad[i] = keyToUse[i] ^ 1549556828;
      }
      intermediateState = roundFunc(keyWithIPad, intermediateState);
      processedLen = variantBlockSize;
      hmacKeySet = true;
    };
    this.update = function(srcString) {
      var convertRet, chunkBinLen, chunkIntLen, chunk, i, updateProcessedLen = 0, variantBlockIntInc = variantBlockSize >>> 5;
      convertRet = converterFunc(srcString, remainder, remainderLen);
      chunkBinLen = convertRet["binLen"];
      chunk = convertRet["value"];
      chunkIntLen = chunkBinLen >>> 5;
      for (i = 0; i < chunkIntLen; i += variantBlockIntInc) {
        if (updateProcessedLen + variantBlockSize <= chunkBinLen) {
          intermediateState = roundFunc(chunk.slice(i, i + variantBlockIntInc), intermediateState);
          updateProcessedLen += variantBlockSize;
        }
      }
      processedLen += updateProcessedLen;
      remainder = chunk.slice(updateProcessedLen >>> 5);
      remainderLen = chunkBinLen % variantBlockSize;
      updatedCalled = true;
    };
    this.getHash = function(format, options) {
      var formatFunc, i, outputOptions, finalizedState;
      if (true === hmacKeySet) {
        throw new Error("Cannot call getHash after setting HMAC key");
      }
      outputOptions = getOutputOpts(options);
      if (isSHAKE === true && (8 & SUPPORTED_ALGS) !== 0) {
        if (outputOptions["shakeLen"] === -1) {
          throw new Error("shakeLen must be specified in options");
        }
        outputBinLen = outputOptions["shakeLen"];
      }
      switch(format) {
        case "HEX":
          formatFunc = function(binarray) {
            return packed2hex(binarray, outputBinLen, bigEndianMod, outputOptions);
          };
          break;
        case "B64":
          formatFunc = function(binarray) {
            return packed2b64(binarray, outputBinLen, bigEndianMod, outputOptions);
          };
          break;
        case "BYTES":
          formatFunc = function(binarray) {
            return packed2bytes(binarray, outputBinLen, bigEndianMod);
          };
          break;
        case "ARRAYBUFFER":
          try {
            i = new ArrayBuffer(0);
          } catch (ignore) {
            throw new Error("ARRAYBUFFER not supported by this environment");
          }
          formatFunc = function(binarray) {
            return packed2arraybuffer(binarray, outputBinLen, bigEndianMod);
          };
          break;
        default:
          throw new Error("format must be HEX, B64, BYTES, or ARRAYBUFFER");
      }
      finalizedState = finalizeFunc(remainder.slice(), remainderLen, processedLen, stateCloneFunc(intermediateState), outputBinLen);
      for (i = 1; i < numRounds; i += 1) {
        if ((8 & SUPPORTED_ALGS) !== 0 && isSHAKE === true && outputBinLen % 32 !== 0) {
          finalizedState[finalizedState.length - 1] &= 16777215 >>> 24 - outputBinLen % 32;
        }
        finalizedState = finalizeFunc(finalizedState, outputBinLen, 0, getNewState(shaVariant), outputBinLen);
      }
      return formatFunc(finalizedState);
    };
    this.getHMAC = function(format, options) {
      var formatFunc, firstHash, outputOptions, finalizedState;
      if (false === hmacKeySet) {
        throw new Error("Cannot call getHMAC without first setting HMAC key");
      }
      outputOptions = getOutputOpts(options);
      switch(format) {
        case "HEX":
          formatFunc = function(binarray) {
            return packed2hex(binarray, outputBinLen, bigEndianMod, outputOptions);
          };
          break;
        case "B64":
          formatFunc = function(binarray) {
            return packed2b64(binarray, outputBinLen, bigEndianMod, outputOptions);
          };
          break;
        case "BYTES":
          formatFunc = function(binarray) {
            return packed2bytes(binarray, outputBinLen, bigEndianMod);
          };
          break;
        case "ARRAYBUFFER":
          try {
            formatFunc = new ArrayBuffer(0);
          } catch (ignore) {
            throw new Error("ARRAYBUFFER not supported by this environment");
          }
          formatFunc = function(binarray) {
            return packed2arraybuffer(binarray, outputBinLen, bigEndianMod);
          };
          break;
        default:
          throw new Error("outputFormat must be HEX, B64, BYTES, or ARRAYBUFFER");
      }
      firstHash = finalizeFunc(remainder.slice(), remainderLen, processedLen, stateCloneFunc(intermediateState), outputBinLen);
      finalizedState = roundFunc(keyWithOPad, getNewState(shaVariant));
      finalizedState = finalizeFunc(firstHash, outputBinLen, variantBlockSize, finalizedState, outputBinLen);
      return formatFunc(finalizedState);
    };
  };
  if ("function" === typeof define && define["amd"]) {
    define(function() {
      return jsSHA;
    });
  } else {
    if ("undefined" !== typeof exports) {
      if ("undefined" !== typeof module && module["exports"]) {
        module["exports"] = jsSHA;
        exports = jsSHA;
      } else {
        exports = jsSHA;
      }
    } else {
      global["jsSHA"] = jsSHA;
    }
  }
})(this);