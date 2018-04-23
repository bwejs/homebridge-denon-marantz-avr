var Service, Characteristic;
var Denon = require('./lib/denon');
var inherits = require('util').inherits;
var pollingtoevent = require('polling-to-event');
const ping = require('./hostportconnectable');


module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  //fixInheritance(DenonAVRAccessory.InputSelect, Characteristic);
  inherits(DenonAVRAccessory.InputSelect, Characteristic);
  
  homebridge.registerAccessory('homebridge-denon-marantz-avr', 'DenonMarantzAVR', DenonAVRAccessory);
};


function fixInheritance(subclass, superclass) {
  var proto = subclass.prototype;
  inherits(subclass, superclass);
  subclass.prototype.parent = superclass.prototype;
  for (var mn in proto) {
    subclass.prototype[mn] = proto[mn];
  }
}

function DenonAVRAccessory(log, config) {
  this.log = log;
  var that = this;
  
  this.config = config;
  this.ip = config['ip'];
  this.name = config['name'];
  this.valueMapping = config['valueMapping']
  this.defaultInput = config['defaultInput'] || null;
  this.defaultVolume = config['defaultVolume'] || null;
  this.minVolume = config['minVolume'] || 0;
  this.maxVolume = config['maxVolume'] || 100;
  this.doPolling = config['doPolling'] || false;
  this.port = 80;
  
  this.pollingInterval = config['pollingInterval'] || "60";
  this.pollingInterval = parseInt(this.pollingInterval)
  
  this.includeSwitchServcie = false 
  
  this.denon = new Denon(this.ip);
  
  
  this.needSendMuteState = false;
  this.needSendVolume = false;
  this.needSendInput = false;
  
  this.setAttempt = 0;
  this.state = false;
  if (this.interval < 10 && this.interval > 100000) {
    this.log("polling interval out of range.. disabled polling");
    this.doPolling = false;
  }
  
  // Status Polling
  if (this.doPolling && this.includeSwitchServcie) {
    that.log("start polling..");
    var statusemitter = pollingtoevent(function(done) {
      that.log("do poll..")
      that.getPowerState( function( error, response) {
        done(error, response, this.setAttempt);
      }, "statuspoll");
    }, {longpolling:true,interval:that.pollingInterval * 1000,longpollEventName:"statuspoll"});
    
    statusemitter.on("statuspoll", function(data) {
      that.state = data;
      that.log("poll end, state: "+data);
      
      if (that.switchService ) {
        that.switchService.getCharacteristic(Characteristic.On).updateValue(that.state, null, "statuspoll");
      }
    });
  }
  
  
  var checkSendNeededEmitter = pollingtoevent(function(done) {
    if (that.needSendMuteState) {
      that.log("Need Send Mute State")
      that.setMuteState(that.targetMuteState, function( error, response) {
        done(null, response, this.setAttempt);
      });
    }

    if(that.needSendVolume){
      that.log("Need Send Volume");
      that.setVolume(that.targetVolume, function( error, response) {
        done(null, response, this.setAttempt);
      });
    }
    if(that.needSendInput) {
      that.log("Need Send Input");
      that.setInputSelect(that.targetInput, function( error, response) {
        done(null, response, this.setAttempt);
      });
    }
  }, {longpolling:true,interval:5 * 1000,longpollEventName:"sendCheck"});
  
}
DenonAVRAccessory.InputSelect = function() {
  Characteristic.call(this, '{"name":"input","values":["appleTV","fireTV","macMini","dreambox"]}', '00001002-0000-1C12-8ABC-135D67EC4377');
  
  this.setProps({
    format: Characteristic.Formats.STRING,
    perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
  });
  
  this.value = this.getDefaultValue();
};


DenonAVRAccessory.prototype.getPowerState = function (callback, context) {
  
  if ((!context || context != "statuspoll") && this.doPolling) {
    callback(null, this.state);
  } else {
    this.denon.getPowerState(function (err, state) {
      if (err) {
        this.log(err);
        callback(null, false);
      } else {
        this.log('current power state is: %s', (state) ? 'ON' : 'OFF');
        callback(null, state);
      }
    }.bind(this));
  }
};


DenonAVRAccessory.prototype.setPowerState = function (powerState, callback, context) {
  var that = this;
  
  //if context is statuspoll, then we need to ensure that we do not set the actual value
  if (context && context == "statuspoll") {
    callback(null, powerState);
    return;
  }
  
  this.setAttempt = this.setAttempt+1;
  
  this.denon.setPowerState(powerState, function (err, state) {
    if (err) {
      this.log(err);
    } else {
      if(powerState && this.defaultInput) {
        //  this.denon.setInput(this.defaultInput, function (error) {
        //                     if (error) {
        //                         this.log('Error setting default input. Please check your config');
        //                     }
        //                 }.bind(this));
      }
      this.log('denon avr powered %s', state);
    }
  }.bind(this));
  
  if (powerState && this.defaultVolume) {
    setTimeout(function () {
      this.denon.setVolume(this.defaultVolume, function (err) {
        if (err) {
          this.log('Error setting default volume');
        }
        this.switchService.getCharacteristic(Characteristic.Volume)
        .updateValue(Math.round(this.defaultVolume / this.maxVolume * 100));
      }.bind(this));
    }.bind(this), 4000);
  }
  callback(null);
};

DenonAVRAccessory.prototype.getInputSelect = function (callback) {
  this.denon.getInput(function (err, name) {
    this.log('searching for ' +name)
    if (typeof name != 'undefined') {
      for (var nameToSend in this.valueMapping) {
        var array = this.valueMapping[nameToSend]
        this.log('prüfe werte von for ' + nameToSend)
        for (var i = 0; i < array.length; i++) {
          var nameInMapping = array[i];
          this.log('vergleiche  for ' +nameInMapping)
          
          if (name.toUpperCase() == nameInMapping.toUpperCase()) {
            this.log('current input is: ' + name);
            callback(null, nameToSend);
            return;
          }
        }
      }
      callback(null, name);
      
      this.log('current input is: ' + name);
    } else {
      callback(null, "");
    }
    
  }.bind(this));
  
};



DenonAVRAccessory.prototype.setInputSelect = function (stringValue, callback) {
  var valueToSend = stringValue;
  this.log('setting input to: ' + stringValue);
  
  if (typeof valueToSend == 'undefined') {
    callback(new Error("No String Defiend"));
    return;
  }
  this.log('valueMapping' + this.valueMapping);
  
  for (var nameToSend in this.valueMapping) {
    this.log('prüfe werte von for ' + nameToSend)
    if (nameToSend.toUpperCase() == stringValue.toUpperCase()) {
      
      var array = this.valueMapping[nameToSend]
      valueToSend = array[0];
    }
  }
  
  this.log('setting input to: ' + stringValue);
  var me = this;
  me.targetInput = stringValue;
  ping.checkHostIsReachable(me.ip, me.port, function (reachable) {
    if (reachable) {
      me.denon.setInput(valueToSend, function (error) {
        if (error) {
          me.needSendInput = true;
          me.log('Error setting default input. Please check your config');
          callback(new Error("Error ." + error));
        } else {
          me.needSendInput = false;
          callback(null);
        }
        
      }.bind(this));
    } else {
      me.needSendInput = true;
      me.log("Not Rechable At the Moment. But Will Set later.");
      callback(new Error("Not Rechable At the Moment. But Will Set later."), null);
    }
  });
};


DenonAVRAccessory.prototype.getVolume = function (callback) {
  this.denon.getVolume(function (err, volume) {
    if (err) {
      this.log('get Volume error: ' + err)
      callback(err);
    } else {
      this.log('current volume is: ' + volume);
      var pVol = Math.round(volume / 100 * 100);
      callback(null, pVol);
    }
  }.bind(this))
};

DenonAVRAccessory.prototype.setVolume = function (pVol, callback) {
  var volume = Math.round(pVol / 100 * 100);
  var me = this;
  me.targetVolume = pVol;
  ping.checkHostIsReachable(me.ip, me.port, function (reachable) {
    if (reachable) {
      var volume = Math.round(pVol / 100 * 100);
      me.denon.setVolume(volume, function (err) {
        if (err) {
          me.needSendVolume = true
          me.log('set Volume error (will set later): ' + err);
          callback(err);
        } else {
          me.needSendVolume = false
          me.log('did set Volume to: ' + volume);
          callback(null);
        }
      }.bind(this))
    } else {
      me.needSendVolume = true;
      me.log("Not Rechable At the Moment. But Will Set later.");
      callback(new Error("Not Rechable At the Moment. But Will Set later."), null);
    }
  });
};

DenonAVRAccessory.prototype.setMuteState = function (state, callback) {
  var me = this;
  me.targetMuteState = state;
  ping.checkHostIsReachable(me.ip, me.port, function (reachable) {
    if (reachable) {
      me.denon.setMuteState(state, function (err) {
        if (err) {
          me.log('set mute error Will Set later: ' + err);
          me.needSendMuteState = true;
          callback(err);
        } else {
          if (me.needSendMuteState) {
            me.speakerService.getCharacteristic(Characteristic.Mute).updateValue(state, null, "statuspoll");
          }
          me.needSendMuteState = false;
          me.log('Did Set Mute State');
          
          callback(null);
        }
      }.bind(me)); 
    } else {
      me.needSendMuteState = true;
      me.log("Not Rechable At the Moment. But Will Set later.");
      callback(new Error("Not Rechable At the Moment. But Will Set later."), null);
    }
  });
};


DenonAVRAccessory.prototype.getMuteState = function (callback) {
  this.denon.getMuteState(function (err, state) {
    if (err) {
      this.log('get mute error: ' + err);
      callback(err);
    } else {
      callback(state);
    }
  }.bind(this))
};

DenonAVRAccessory.prototype.getServices = function () {
  var informationService = new Service.AccessoryInformation();
  
  informationService
  .setCharacteristic(Characteristic.Name, this.name)
  .setCharacteristic(Characteristic.Manufacturer, this.type || 'Denon');
  
  
  
  
  this.speakerService = new Service.Speaker(this.name);
  
  this.speakerService.getCharacteristic(Characteristic.Mute)
  .on('get', this.getMuteState.bind(this))
  .on('set', this.setMuteState.bind(this));
  
  this.speakerService.getCharacteristic(Characteristic.Volume)
  .on('get', this.getVolume.bind(this))
  .setProps({minValue: this.minVolume, maxValue: this.maxVolume})
  .on('set', this.setVolume.bind(this));
  
  /*
  this.minVolume = config['minVolume'] || 0;
  this.maxVolume
  */  
  
  this.speakerService.addCharacteristic(DenonAVRAccessory.InputSelect)
  .on('get', this.getInputSelect.bind(this))
  .on('set', this.setInputSelect.bind(this));
  var list = [informationService, this.speakerService];
  
  if (this.includeSwitchServcie) {
    this.switchService = new Service.Switch(this.name);
    this.switchService.getCharacteristic(Characteristic.On)
    .on('get', this.getPowerState.bind(this))
    .on('set', this.setPowerState.bind(this));
    
    list.push(this.switchService);
  }
  
  return list;
};
