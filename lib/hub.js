/**
 * Created by kraig on 3/20/16.
 */

var Promise = require('bluebird');
var ActivityAccessory = require('./activity-accessory').ActivityAccessory;
var CommandAccessory = require('./command-accessory').CommandAccessory;
var _ = require('lodash');

module.exports = function(exportedTypes) {
	return Hub;
};
module.exports.Hub = Hub;

function Hub(log, config, connection) {
	this.connection = connection;
	this.log = log;
  	this.config = config;
}

Hub.prototype.updateConnection = function(connection) {
	this.connection = connection;
	_.forEach(this._accessories, function(acc){
		if (acc.updateConnection) acc.updateConnection(connection);
	});
};

Hub.prototype.getAccessoriesAsync = function() {
	if (this._accessories) {
		return Promise.resolve(this._accessories);
	}
	return this.updateAccessoriesAsync();
};

Hub.prototype.updateAccessoriesAsync = function(cachedAccessories) {
	var self = this;
	var conn = this.connection;

	var activityCachedAcc = _.find(cachedAccessories, function (acc) {
		return acc.context.typeKey.toString().trim() == ActivityAccessory.typeKey;
	});
	var activityAcc = _.find(this._accessories, function (a) { return a instanceof ActivityAccessory; });
	if (!activityAcc) activityAcc = new ActivityAccessory(activityCachedAcc, this.log, conn);
	var activityTask = activityAcc.initAsync().return(activityAcc);
  
  
	var commandCachedAcc = _.find(cachedAccessories, function (acc) {
		return acc.context.typeKey.toString().trim() == CommandAccessory.typeKey;
	});
	var commandAcc = _.find(this._accessories, function (a) { return a instanceof CommandAccessory; });

	if (!commandAcc) commandAcc = new CommandAccessory(commandCachedAcc, this.log, conn, self.config.commands);
	var commandTask = commandAcc.initAsync().return(commandAcc);

	return Promise.all([
			activityTask,
      		commandTask
		])
		.tap(function(accessories){
			self._accessories = accessories;
		});
};

