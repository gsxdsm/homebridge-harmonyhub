/**
 * Created by kraig on 3/20/16.
 */

var util = require('util');
var inherit = require('./inherit');
var Promise = require('bluebird');
var queue = require('queue');
var HubAccessoryBase = require('./hub-accessory-base').HubAccessoryBase;
var HubConnection = require('./hub-connection');
var HubConnectionStatus = HubConnection.ConnectionStatus;
var _ = require('lodash');

var Service, Characteristic;

module.exports = function(exportedTypes) {
	if (exportedTypes && !Service) {
		Service = exportedTypes.Service;
		Characteristic = exportedTypes.Characteristic;
		inherit.changeBase(CommandService, Service.Switch);
		CommandService.UUID = Service.Switch.UUID;
	}
	return CommandAccessory;
};
module.exports.CommandAccessory = CommandAccessory;

const CommandStatus = {
	Off: 0,
	Starting: 1,
	Started: 2,
	TurningOff: 3
};
module.exports.CommandStatus = CommandStatus;


function CommandAccessory(accessory, log, connection, commands) {
	this._onConnectionChanged = onConnectionChanged.bind(this);
	this._onStateChanged = onStateChanged.bind(this);
  this.commands = commands;
  this.log = log;
	HubAccessoryBase.call(this, accessory, connection, CommandAccessory.typeKey, "commandAccessory", log);
}
util.inherits(CommandAccessory, HubAccessoryBase);
CommandAccessory.typeKey = 'command';

CommandAccessory.createAsync = function(accessory, log, connection) {
	var acc = new CommandAccessory(accessory, log, connection);
	return acc.initAsync()
		.return(acc);
};

CommandAccessory.prototype.initAsync = function() {
	if (!this.connection) return Promise.resolve();

	this.log("Setting up Logitech Harmony commands...");
	var self = this;
  self._updateCommands(this.commands);
  return Promise.resolve();

};

CommandAccessory.prototype.updateConnection = function() {
	var oldConn = this.connection;
	var rtn = HubAccessoryBase.prototype.updateConnection.apply(this, arguments);
	var newConn = this.connection;
	if (oldConn != newConn) {
		if (oldConn) {
			oldConn.removeListener(HubConnection.Events.ConnectionChanged, this._onConnectionChanged);
			oldConn.removeListener(HubConnection.Events.StateDigest, this._onStateChanged);
		}
		if (newConn) {
			newConn.addListener(HubConnection.Events.ConnectionChanged, this._onConnectionChanged);
			newConn.addListener(HubConnection.Events.StateDigest, this._onStateChanged);
		}
	}
	return rtn;
};

var onConnectionChanged = function(connStatus) {
	if (connStatus == HubConnectionStatus.Connected) {

	}
};
var onStateChanged = function(args) {
	var stateDigest = args.stateDigest;
	var activityId = stateDigest && stateDigest.activityId;
};

CommandAccessory.prototype._updateCommands = function(list) {
	var self = this;
	var commands = _.sortBy(list, 'label');
	var cmdAccList = this._getCommandServices();
	if (!_.isEmpty(cmdAccList)) {
		var invalidCommandServices = _.differenceWith(cmdAccList, commands, function (service, command) {
			return matchesCommandForService(service, command);
		});
		_.forEach(invalidCommandServices, function (service) {
			self.accessory.removeService(service);
		});
		_.forEach(cmdAccList, self._bindService.bind(self));
	}
	_.forEach(commands, function(command) {
		var service = self._getCommandService(command);
		if (service == null) return;
		updateCommandForService(service, command);
		service.getCharacteristic(Characteristic.On).setValue(false, null, true);
	});
	
};

CommandAccessory.prototype._getCommandService = function(command) {
	if (!this.accessory) return null;
	//TODO: Use matchesActivityForService
	var commandId = getCommandId(command);
	if (commandId == null) return null;
	var service = _.find(this._getCommandServices(), function(service) {
		return getServiceCommandId(service) == commandId;
	});
	if (!service && isCommandInfo(command)) {
		service = this.accessory.addService(CommandService, command);
		this._bindService(service);
	}
	return service;
};

CommandAccessory.prototype._getCommandServices = function() {
	return _.filter(this.accessory && this.accessory.services, CommandService.isInstance);
};

CommandAccessory.prototype._bindService = function(service) {
	if (service._isAccBound) return;

	var c = service.getCharacteristic(Characteristic.On);
	c.on('set', this._setCommandServiceOn.bind(this, service));

	service._isAccBound = true;
};
CommandAccessory.prototype._setCommandServiceOn = function(service, isOn, callback, doIgnore) {
	if (doIgnore == true) {
		callback();
		return;
	}
	var self = this;
	var cmdId = isOn ? getServiceCommandId(service) : '-1';
	var c = service.getCharacteristic(Characteristic.On);
	var finish = function() {
		var cb = callback;
		callback = null;
		c.removeListener('change', onChange);
		if (cb) cb.apply(this, arguments);
	};
	var onChange = function(args) {
		if (args.newValue != isOn) return;
		finish();
	};

	return this.connection
		.invokeAsync(function(client) {
      client.getAvailableCommands()
      .then(function (commands) {
        //self.log("Commands", commands);
        var devices = commands.device;
        var targetDevice = _.find(devices, function (device) {
		      return device.label === service.command.device;
        });
        if (targetDevice){
          var control = _.find(targetDevice.controlGroup, function (control) {
  		      return control.name === service.command.command_type;
          });
          //self.log("Control", control)
          //go through each command value and call the function
          _.forEach(service.command.command_value.split(','), function(value) {
            //
            var controlFunction = control['function']
            .filter(function (action) { return action.label.toLowerCase() === value})
            .pop()
            if (controlFunction) {
              var encodedAction = controlFunction.action.replace(/\:/g, '::')
              client.send('holdAction', 'action=' + encodedAction + ':status=press:timestamp=1')
              client.send('holdAction', 'action=' + encodedAction + ':status=release:timestamp=10')
            } else {
              throw new Error('could not find function for', service.command.device)
            }
          });
        }
    		//Turn the button off
    		service.getCharacteristic(Characteristic.On).setValue(false, null, true);
      })
		})
		.asCallback(finish)
		.finally(function(){
			self.log.debug("Switch Task Finished: " + cmdId);
		});
};

/**
 * Command Service
 * @param command
 * @constructor
 */
var CommandService = function(command) {
	Service.Switch.call(this, command.label, getCommandId(command));
	this.updateCommand(command);
};

CommandService.isInstance = function(service){
	return ((service instanceof CommandService) || (CommandService.UUID === service.UUID)) &&
		(service.subtype != null);
};

//TODO: Make all command services CommandService (aka cached services)
CommandService.prototype.updateCommand = function(command) {
	return updateCommandForService(this, command);
};
var updateCommandForService = function(service, command) {
	service.command = command;
	service.setCharacteristic(Characteristic.Name, command.label);
};

//TODO: Make all command services CommandService (aka cached services)
CommandService.prototype.matchesCommand = function(command) {
	return matchesCommandForService(this, command);
};
var matchesCommandForService = function(service, command) {
	var commandId = getCommandId(command);
	return commandId != null && getServiceCommandId(service) == commandId;
};

//TODO: Make all command services CommandService (aka cached services)
var getServiceCommandId = function(service) {
	if (!service) service = this;
	return getCommandId(service.command) || service.subtype;
};
Object.defineProperty(CommandService.prototype, 'commandId', {
	get: getServiceCommandId
});

var isCommandInfo = function(command) {
	return command != null && command.id != null;
};

var getCommandId = function(command) {
	return isCommandInfo(command) ? command.id : command;
};

