const TeslaOAuth2Device = require('../../lib/TeslaOAuth2Device');
const Homey = require('homey');
const { CarServer } = require('../../lib/CarServer.js');
const Eckey = require('eckey-utils');

const CAPABILITY_DEBOUNCE = 500;
const DEFAULT_SYNC_INTERVAL = 1000 * 60 * 10; // 10 min
const WAIT_ON_WAKE_UP = 20; // 20 sec
const RETRY_COUNT = 3; // number of retries sending commands
const RETRY_DELAY = 5; // xx seconds delay between retries sending commands

const CONSTANTS = require('../../lib/constants');

module.exports = class CarDevice extends TeslaOAuth2Device {

  async onOAuth2Init() {
    this.log("onOAuth2Init()");
    await super.onOAuth2Init();
    
    await this._updateCapabilities();

    this.registerMultipleCapabilityListener(this.getCapabilities(), async (capabilityValues, capabilityOptions) => {
      // try{
          await this._onCapability( capabilityValues, capabilityOptions);
      // }
      // catch(error){
      //     this.log("_onCapability() Error: ",error.message);
      //     throw error;
      // }
  }, CAPABILITY_DEBOUNCE);


    this._settings = this.getSettings();
    await this._startSync();
    this._sync();

    // Init Tesla Vehicle COmmand Protocol
    let keyFile = Homey.env.APP_PRIV_KEY;
    let key = Eckey.parsePem(keyFile);
    this.commandApi = await new CarServer(this.oAuth2Client, this.getData().id, key);
  }

  async onOAuth2Deleted() {
    await super.onOAuth2Deleted();
    await _stopSync();
  }

  async onDeleted(){
    await _stopSync();
    await super.onDeleted();
  }

  async onOAuth2Saved() {
    this.log("onOAuth2Saved()");
    this._startSync();
    this._sync();
  }

  // Device handling =======================================================================================
  async _updateCapabilities(){
    let capabilities = [];
    try{
      capabilities = this.homey.app.manifest.drivers.filter((e) => {return (e.id == this.driver.id);})[0].capabilities;
      // remove capabilities
      let deviceCapabilities = this.getCapabilities();
      for (let i=0; i<deviceCapabilities.length; i++){
        let filter = capabilities.filter((e) => {return (e == deviceCapabilities[i]);});
        if (filter.length == 0 ){
          try{
            await this.removeCapability(deviceCapabilities[i]);
          }
          catch(error){}
        }
      }
      // add missing capabilities
      for (let i=0; i<capabilities.length; i++){
        if (!this.hasCapability(capabilities[i])){
          try{
            await this.addCapability(capabilities[i]);
          }
          catch(error){}
        }
      }
    }
    catch (error){
      this.error(error.message);
    }
  }

  async handleApiOk(){
    try{
      await this.setSettings({
        api_state: 'OK' 
      }); 
      let oldState = this.getCapabilityValue('alarm_api_error');
      await this.setCapabilityValue('api_error', null);
      await this.setCapabilityValue('alarm_api_error', false);
      if (oldState != false){
        await this.homey.flow.getDeviceTriggerCard('alarm_api_error_off').trigger(this);
      }
    }
    catch(error){
      this.log(error);
    }
  }

  async handleApiError(error){
    try{
      let apiState = 'Error';
      switch (error.constructor.name){
        case 'FetchError':
          this.log("API Error: "+ error.type);
          apiState = error.type;
          break;
        // case 'Error':
        //   if (error.status != undefined && error.statusText != undefined){
        //     this.log("API Error: "+ error.status + ' ' + error.statusText);
        //   }
        //   else{
        //     this.log("API Error: "+ error.message);
        //   }
        //   break;
        default:
          this.log("API Error: "+ error.message);
          apiState = error.message;
      }
      await this.setSettings({
        api_state: apiState 
      });
      let oldState = this.getCapabilityValue('alarm_api_error');
      await this.setCapabilityValue('api_error', apiState);
      await this.setCapabilityValue('alarm_api_error', true);
      if (oldState != true){
        let tokens = {
          error: apiState
        };
        await this.homey.flow.getDeviceTriggerCard('alarm_api_error_on').trigger(this, tokens);
      }
    }
    catch(error){
      this.log(error);
    }
  }

  // SETTINGS =======================================================================================

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log(`[Device] ${this.getName()}: settings where changed: ${changedKeys}`);
    this._settings = newSettings;
    this._startSync();
    this._sync();
  }

  getCommandApi(){
    return this._settings.command_api;
  }

  // SYNC Logic =======================================================================================

  async _startSync(){
    await this._stopSync();
    if (!this._settings.polling_active){
      return;
    }
    // Interval settings is in minutes, convert to milliseconds.
    let interval = DEFAULT_SYNC_INTERVAL;
    if (!this.isAsleep()){
      interval = this._settings.polling_interval_online * 1000;
      if (this._settings.polling_unit_online == 'min'){
        interval = interval * 60;
      }
      this.log(`[Device] ${this.getName()}: Start ONLINE Poll interval: ${interval} sec.`);
    }
    else{
      interval = this._settings.polling_interval_offline * 1000;
      if (this._settings.polling_unit_offline == 'min'){
        interval = interval * 60;
      }
      this.log(`[Device] ${this.getName()}: Start OFFLINE Poll interval: ${interval} sec.`);
    }

    this._syncInterval = this.homey.setInterval(() => this._sync(), interval);
    // this._sync();
  }

  async _stopSync(){
    if (this._syncInterval) {
      this.homey.clearInterval(this._syncInterval);
    }
  }

  // SYNC =======================================================================================

  // async _sync() {
  //   this.log("Car data request...");
  //   let state;
  //   // Step 1: Get car status (online/offline/asleep) and check device availability
  //   try{
  //     // get current device state
  //     state = await this.getCarState();
  //     this.setAvailable();
  //   }
  //   catch(error){
  //     this.log("Device update error (getState): ID: "+this.getData().id+" Name: "+this.getName()+" Error: "+error.message);
  //     this.setUnavailable(error.message).catch(this.error);
  //     await this.handleApiError(error);
  //   };

  //   // Step 2: Get car data, verify ONLINE state with a direct car request 
  //   if (state == CONSTANTS.STATE_ONLINE){
  //     try{
  //       // update the device
  //       await this.getCarData();
  //       await this.handleApiOk();
  //     }
  //     catch(error){
  //       this.log("Device update error (getData): ID: "+this.getData().id+" Name: "+this.getName()+" Error: "+error.message);
  //       await this.handleApiError(error);
  //     }
  //   }
  //   else{
  //     await this.handleApiOk();
  //   }
  // }

  // Read cas status (onlien or not)
  // async getCarState(){
  //   let oldState = this.getCapabilityValue('car_state');
  //   let vehicle = await this.oAuth2Client.getVehicle(this.getData().id);

  //   this.log("Car state: ", vehicle.state);

  //   // If state changed, then adjust sync interval
  //   if (vehicle.state != oldState){
  //     // Update state only if != ONLINE. Check ONLINE state in getCarData( ) to verify direct online request.
  //     if (vehicle.state != CONSTANTS.STATE_ONLINE){
  //       await this.setCapabilityValue('car_state', vehicle.state);
  //       let time = this._getLocalTimeString(new Date());
  //       await this.setCapabilityValue('last_update', time);
  //     }

  //     // From asleep to online/offline or back?
  //     // Change Sync only is asleep state is changed to continue short interval check is car is temporary offline
  //     if (
  //         ( vehicle.state == CONSTANTS.STATE_ASLEEP && oldState != CONSTANTS.STATE_ASLEEP )
  //           ||
  //         ( vehicle.state != CONSTANTS.STATE_ASLEEP && oldState == CONSTANTS.STATE_ASLEEP )
  //     ){
  //       this._startSync(vehicle.state);
  //     }
  //   }
  //   return vehicle.state;
  // }

  async _sync() {
    this.log("Car data request...");
    try{
      // update the device
      await this.getCarData();
      await this.handleApiOk();
      this.setAvailable();
    }
    catch(error){
      this.log("Device update error (getState): ID: "+this.getData().id+" Name: "+this.getName()+" Error: "+error.message);
      this.setUnavailable(error.message).catch(this.error);
      await this.handleApiError(error);
    };
  }

  async getCarState(){
    // let oldState = this.getCapabilityValue('car_state');
    let vehicle = await this.oAuth2Client.getVehicle(this.getData().id);
    this.log("Car state: ", vehicle.state);

    // // If state changed, then adjust sync interval
    // if (vehicle.state != oldState){
    //   // Update state only if != ONLINE. Check ONLINE state in getCarData( ) to verify direct online request.
    //   if (vehicle.state != CONSTANTS.STATE_ONLINE){
    //     await this.setCapabilityValue('car_state', vehicle.state);
    //     let time = this._getLocalTimeString(new Date());
    //     await this.setCapabilityValue('last_update', time);
    //   }

    //   // From asleep to online/offline or back?
    //   // Change Sync only is asleep state is changed to continue short interval check is car is temporary offline
    //   if (
    //       ( vehicle.state == CONSTANTS.STATE_ASLEEP && oldState != CONSTANTS.STATE_ASLEEP )
    //         ||
    //       ( vehicle.state != CONSTANTS.STATE_ASLEEP && oldState == CONSTANTS.STATE_ASLEEP )
    //   ){
    //     this._startSync(vehicle.state);
    //   }
    // }
    return vehicle.state;
  }

  // Read car data. Car must be awake.
  async getCarData(){
    let oldState = this.getCapabilityValue('car_state');

    // get buffered car state
    let vehicle = await this.oAuth2Client.getVehicle(this.getData().id);
    this.log("Car state: ", vehicle.state);
    if (vehicle.state == CONSTANTS.STATE_ASLEEP){
      await this.setCapabilityValue('car_state', vehicle.state);
      let time = this._getLocalTimeString(new Date());
      await this.setCapabilityValue('last_update', time);
      // From asleep to online/offline or back?
      // Change Sync only if state changed from online/offline to asleep or from asleep to online/offline
      if ( oldState != CONSTANTS.STATE_ASLEEP ){
        this._startSync();
      }
      return;
    }

    // car data
    let query = ['charge_state', 'climate_state', 'closures_state', 'drive_state', 'gui_settings', 'vehicle_config', 'vehicle_state'];
    if (this._settings.polling_location){
      query.push('location_data');
    }
    let data = {};
    try{
      data = await this.oAuth2Client.getVehicleData(this.getData().id, query);

      this.log("Car data request state: ", data.state);
      // Update car state to ONLINE if request was successful
      await this.setCapabilityValue('car_state', data.state);
      let time = this._getLocalTimeString(new Date());
      await this.setCapabilityValue('last_update', time);
      if (oldState == CONSTANTS.STATE_ASLEEP){
        // From asleep to online?
        // Change Sync only is asleep state is changed to continue short interval check is car is temporary offline
        this._startSync();
      }

      this._updateDevice(data);
    }
    catch(error){
      // Check for "Offline" errors (408)
      // Set car state to "offline"
      // Forward all other errors
      if (error.status && error.status == 408){
        this.log("Car data request error: ", error.status);
        let oldState = this.getCapabilityValue('car_state');
        await this.setCapabilityValue('car_state', CONSTANTS.STATE_OFFLINE);
        let time = this._getLocalTimeString(new Date());
        await this.setCapabilityValue('last_update', time);
        // state change from asleep to offline => Start new sync interval
        if (oldState == CONSTANTS.STATE_ASLEEP){
          // From asleep to offline?
          // Change Sync only is asleep state is changed to continue short interval check is car is temporary offline
          this._startSync();
        }
        return;
      }
      else{
        throw error;
      }
    }
  }

  async _updateDevice(data){
    // Car state
    if (this.hasCapability('car_doors_locked') && data.charge_state && data.vehicle_state.locked != undefined){
      await this.setCapabilityValue('car_doors_locked', !data.vehicle_state.locked);
    }
    if (this.hasCapability('car_sentry_mode') && data.charge_state && data.vehicle_state.sentry_mode != undefined){
      await this.setCapabilityValue('car_sentry_mode', data.vehicle_state.sentry_mode);
    }

    // Battery
    if (this.hasCapability('measure_battery') && data.charge_state && data.charge_state.battery_level != undefined){
      await this.setCapabilityValue('measure_battery', data.charge_state.battery_level);
    }

    // Meter Odo
    if (this.hasCapability('meter_car_odo') && data.vehicle_state && data.vehicle_state.odometer != undefined){
      await this.setCapabilityValue('meter_car_odo', data.gui_settings.gui_distance_units == 'km/hr' ? data.vehicle_state.odometer * CONSTANTS.MILES_TO_KM : data.vehicle_state.odometer);
    }
    // Capability units
    let co = this.getCapabilityOptions("meter_car_odo");
    let distUnit = data.gui_settings.gui_distance_units == 'km/hr' ? 'km' : 'mi';
    if (!co || !co.units || co.units != distUnit){
      co['units'] = distUnit;
      this.setCapabilityOptions('meter_car_odo', co);
    }

    // Drive state
    if (this.hasCapability('car_shift_state') && data.drive_state && (data.drive_state.shift_state != undefined || data.drive_state.shift_state == null)){
      if (data.drive_state.shift_state == null || data.drive_state.shift_state == 'P'){
        await this.setCapabilityValue('car_shift_state', 'P');
      }
      else{
        await this.setCapabilityValue('car_shift_state', data.drive_state.shift_state);
      }
      // states:
      // R
      // D
      // null = P
    }
    if (this.hasCapability('measure_car_drive_speed') && data.drive_state && data.drive_state.speed != undefined){
      await this.setCapabilityValue('measure_car_drive_speed', Math.round( data.gui_settings.gui_distance_units == 'km/hr' ? data.drive_state.speed * CONSTANTS.MILES_TO_KM :  data.drive_state.speed ) );
    }
    // Capability units
    co = this.getCapabilityOptions("measure_car_drive_speed");
    let speedUnit = data.gui_settings.gui_distance_units == 'km/hr' ? 'km/h' : 'mi/h';
    if (!co || !co.units || co.units != speedUnit){
      co['units'] = speedUnit;
      this.setCapabilityOptions('measure_car_drive_speed', co);
    }

    // Tires/TPMS
    if (this.hasCapability('measure_car_tpms_pressure_fl') && data.vehicle_state && data.vehicle_state.tpms_pressure_fl != undefined){

      await this.setCapabilityValue('measure_car_tpms_pressure_fl', data.gui_settings.gui_tirepressure_units == 'Bar'? data.vehicle_state.tpms_pressure_fl : data.vehicle_state.tpms_pressure_fl * 14,5038);
    }
    if (this.hasCapability('measure_car_tpms_pressure_fr') && data.vehicle_state && data.vehicle_state.tpms_pressure_fr != undefined){
      await this.setCapabilityValue('measure_car_tpms_pressure_fr', data.gui_settings.gui_tirepressure_units == 'Bar'? data.vehicle_state.tpms_pressure_fr : data.vehicle_state.tpms_pressure_fr * 14,5038);
    }
    if (this.hasCapability('measure_car_tpms_pressure_rl') && data.vehicle_state && data.vehicle_state.tpms_pressure_rl != undefined){
      await this.setCapabilityValue('measure_car_tpms_pressure_rl', data.gui_settings.gui_tirepressure_units == 'Bar'? data.vehicle_state.tpms_pressure_rl : data.vehicle_state.tpms_pressure_rl * 14,5038);
    }
    if (this.hasCapability('measure_car_tpms_pressure_rr') && data.vehicle_state && data.vehicle_state.tpms_pressure_rr != undefined){
      await this.setCapabilityValue('measure_car_tpms_pressure_rr', data.gui_settings.gui_tirepressure_units == 'Bar'? data.vehicle_state.tpms_pressure_rr : data.vehicle_state.tpms_pressure_rr * 14,5038);
    }
    // Capability units
    co = this.getCapabilityOptions("measure_car_tpms_pressure_fl");
    if (!co || !co.units || co.units != data.gui_settings.gui_tirepressure_units){
      co['units'] = data.gui_settings.gui_tirepressure_units;
      this.setCapabilityOptions('measure_car_tpms_pressure_fl', co);
      this.setCapabilityOptions('measure_car_tpms_pressure_fr', co);
      this.setCapabilityOptions('measure_car_tpms_pressure_rl', co);
      this.setCapabilityOptions('measure_car_tpms_pressure_rr', co);
    }

    // Trunk
    if (this.hasCapability('car_trunk_front') && data.vehicle_state && data.vehicle_state.ft != undefined){
      //ft==0: closed
      await this.setCapabilityValue('car_trunk_front', data.vehicle_state.ft != 0);
    }
    if (this.hasCapability('car_trunk_rear') && data.vehicle_state && data.vehicle_state.rt != undefined){
      //rt==0: closed
      await this.setCapabilityValue('car_trunk_rear', data.vehicle_state.rt != 0);
    }

    // Software
    if (this.hasCapability('car_software_version') && data.vehicle_state && data.vehicle_state.car_version != undefined){
      await this.setCapabilityValue('car_software_version', data.vehicle_state.car_version.split(' ')[0]);
    }
    if (this.hasCapability('car_software_update_version') && data.vehicle_state && data.vehicle_state.software_update && data.vehicle_state.software_update.version != undefined){
      await this.setCapabilityValue('car_software_update_version', data.vehicle_state.software_update.version);
    }

    if (this.hasCapability('car_software_update_state') && data.vehicle_state && data.vehicle_state.software_update && data.vehicle_state.software_update.status != undefined){
      if (  this.getCapabilityValue('car_software_update_state') != data.vehicle_state.software_update.status &&
            data.vehicle_state.software_update.status == 'available'){
        // Trigger software available flow
        let tokens = {
          car_software_update_state: data.vehicle_state.software_update.status,
          car_software_version: data.vehicle_state.car_version.split(' ')[0],
          car_software_update_version: data.vehicle_state.software_update.version
        }
        await this.homey.flow.getDeviceTriggerCard('car_software_update_available').trigger(this, tokens);
      }

      await this.setCapabilityValue('car_software_update_state', data.vehicle_state.software_update.status);
      // Possible states:
      // available
      // scheduled
      // installing
      // downloading
      // downloading_wifi_wait
    }

    
    // Update child devices
    let batteryDevice = this.homey.drivers.getDriver('battery').getDevices().filter(e => {return (e.getData().id == this.getData().id)})[0];
    if (batteryDevice){
      await batteryDevice.updateDevice(data);
    }
    let climateDevice = this.homey.drivers.getDriver('climate').getDevices().filter(e => {return (e.getData().id == this.getData().id)})[0];
    if (climateDevice){
      await climateDevice.updateDevice(data);
    }
    let locationDevice = this.homey.drivers.getDriver('location').getDevices().filter(e => {return (e.getData().id == this.getData().id)})[0];
    if (locationDevice){
      await locationDevice.updateDevice(data);
    }

  }

  // State checks =======================================================================================

  isOnline(){
    if (this.getCapabilityValue('car_state') == CONSTANTS.STATE_ONLINE){
      return true;
    }
    else{
      return false;
    }
  }

  isAsleep(){
    if (this.getCapabilityValue('car_state') == CONSTANTS.STATE_ASLEEP){
      return true;
    }
    else{
      return false;
    }
  }

  // Commands =======================================================================================
  async _wakeUp(wait=true){
    this.log("Wake up the car...");
    let state = await this.getCarState();
    if (state == CONSTANTS.STATE_ONLINE){
      this.log("Car is already online.");
      return true;
    }
    await this.oAuth2Client.commandWakeUp(this.getData().id);
    if (wait){
      let state;
      for (let i=0; i<WAIT_ON_WAKE_UP; i++){
        this.log("Wake up the car...Online-Check "+i);
        await this._wait();
        state = await this.getCarState();
        if (state == CONSTANTS.STATE_ONLINE){
          this.log("Wake up the car...Car is online now");
          // automatically sync data after wake up
          await this._sync()
          return true;
        }
      }
    }
    this.log("Wake up the car...Car is not online yet.");
    let error = new Error("Waking up the vehicle was not successful.");
    await this.handleApiError(error);
    throw error;
  }

  async wakeUpIfNeeded(){
    if (this.getSetting('command_wake_up')){
      await this._wakeUp(true);
    }
  }

  async sendCommand(apiFunction, params){
    try{
      await this.wakeUpIfNeeded();
      let retryCount = 0;
      if (this._settings.command_retry){
        retryCount = RETRY_COUNT - 1;
      }
      for (let i=0; i<=retryCount; i++){
        try{
          await this._sendCommand(apiFunction, params);
          break;
        }
        catch(error){
          if (i==retryCount){
            throw error;
          }
          else{
            this.log("Retry in "+RETRY_DELAY+" sec...");
            await this._wait(RETRY_DELAY * 1000);
          }
        }
      }
      await this.handleApiOk();
    }
    catch(error){
      await this.handleApiError(error);
      throw error;
    }
  }

  async _sendCommand(apiFunction, params){
    // Use direct Command Protocol?
    if (  this.getCommandApi() == CONSTANTS.COMMAND_API_CMD 
          &&
          // Endpoints that will only work with REST API: 
          apiFunction != 'commandNavigateGpsRequest' &&
          apiFunction != 'commandNavigationRequest' &&
          apiFunction != 'commandNavigateGpsRequest'
        ){
      await this._sendSignedCommand(apiFunction, params);
    }
    else{
      if (apiFunction == 'ping'){
        throw new Error("Command "+apiFunction+" not supported for REST or Proxy API.");
      }
      this.log("Send REST command: API: "+this.getCommandApi()+"; API function: "+apiFunction+"; Parameter: ",params);
      await this.oAuth2Client[apiFunction](this.getCommandApi(), this.getData().id, params);
    }
  }

  async _sendSignedCommand(apiFunction, apiParams){
    let {command, params, domain} = this._getSignedCommand(apiFunction, apiParams);
    this.log("Send signed command: API function: "+apiFunction+"; Command: "+command+"; Parameter: ",params);
    await this.commandApi.sendSignedCommand(command, params, domain);
    this.log("Send signed command: Success");
  }

  _getSignedCommand(apiFunction, params){
    let result = {
      command: null,
      params: {}
    };
    switch (apiFunction) {
      // car actions
      case 'ping':
        result.command = 'ping';
        result.params = { };
        break;

      case 'commandSentryMode':
        result.command = 'vehicleControlSetSentryModeAction';
        result.params = { on: params.state};
        break;

      case 'commandDoorLock':
        if (params.locked){
          result.command = 1;
          // result.command = 'RKE_ACTION_LOCK';
        }
        else{
          result.command = 0;
          // result.command = 'RKE_ACTION_UNLOCK';
        }
        result.params = {};
        result.domain = CONSTANTS.DOMAIN_VEHICLE_SECURITY;
        break;

      case 'commandFlashLights':
        result.command = 'vehicleControlFlashLightsAction';
        result.params = {};
        break;

      // case 'commandTrunk':
      //   result.command = '???';
      //   result.params = {};
      //   break;
  
      case 'commandHonkHorn':
        result.command = 'vehicleControlHonkHornAction';
        result.params = {};
        break;
  
      case 'commandWindowPosition':       // car and climate
        if (params.position == 'vent'){
          result.command = 'vehicleControlWindowActionVent';
        }
        else{
          result.command = 'vehicleControlWindowActionClose';
        }
        result.params = { action : 3};
        break;

      case 'commandScheduleSoftwareUpdate':
        result.command = 'vehicleControlScheduleSoftwareUpdateAction';
        result.params = { offset_sec: params.minutes * 60};
        break;
  
      // charging actions
      case 'commandChargeLimit':
        result.command = 'chargingSetLimitAction';
        result.params = { percent: params.limit};
        break;

      case 'commandChargeCurrent':
        result.command = 'setChargingAmpsAction';
        result.params = { charging_amps : params.current};
        break;
  
      case 'commandChargePort':
        if (params.state){
          result.command = 'chargePortDoorOpen';
        }
        else{
          result.command = 'chargePortDoorClose';
        }
        result.params = { };
        break;

      case 'commandChargeOn':
        if (params.state){
          result.command = 'chargingStartStopActionStart';
          // result.domain = CONSTANTS.DOMAIN_VEHICLE_SECURITY;
        }
        else{
          result.command = 'chargingStartStopActionStop';
          // result.domain = CONSTANTS.DOMAIN_VEHICLE_SECURITY;
        }
        params.state = {};
        break;

      case 'commandScheduleCharging':
        result.command = 'scheduledChargingAction';
        result.params = { 
          enabled: true,
          charging_time : (params.hh * 60 + params.mm)
        };
        break;

      case 'commandDeactivateScheduledCharging':
        result.command = 'scheduledChargingAction';
        result.params = { 
          enabled: false,
          charging_time : 0
        };
        break;
  
      case 'commandScheduleDeparture':
      // preconditioning_times   : "preconditioning_enabled", "preconditioning_weekdays_only"
        result.command = 'scheduledDepartureAction';
        result.params = { 
          enabled: true,
          departure_time: (params.hh * 60 + params.mm),
          preconditioning_enabled: params.preconditioning_enabled,
          preconditioning_weekdays_only: params.preconditioning_weekdays_only,
          off_peak_charging_enabled: params.off_peak_charging_enabled,
          off_peak_charging_weekdays_only: params.off_peak_charging_weekdays_only,
          end_off_peak_time: (params.op_hh * 60 + params.op_mm)
  
        };
        break;

      case 'commandDeactivateScheduledDeparture':
        // preconditioning_times   : "preconditioning_enabled", "preconditioning_weekdays_only"
          result.command = 'scheduledDepartureAction';
          result.params = { 
            enabled: false,
            departure_time: 0,
            preconditioning_enabled: false,
            preconditioning_weekdays_only: false,
            off_peak_charging_enabled: false,
            off_peak_charging_weekdays_only: false,
            end_off_peak_time: 0
    
          };
          break;
    
      // location actions
      // case 'commandNavigateGpsRequest':
      //   result.command = 'chargingSetLimitAction';
      //   result.params = { percent: params.limit};
      //   break;

      // climate actions
      case 'commandSetTemperature':
        result.command = 'hvacTemperatureAdjustmentAction';
        result.params = { 
          driver_temp_celsius : params.driverTemperature,
          passenger_temp_celsius : params.passengerTemperature
        };
        break;

      case 'commandPreconditioning':
        result.command = 'hvacAutoAction';
        result.params = { 
          power_on : params.on
          // manual_override: true
        };
        break;

      case 'commandOverheatprotectionMode':
        result.command = 'setCabinOverheatProtectionAction';
        result.params = {
          on: (params.mode != 'off'),
          fan_only: (params.mode == 'fan_only')
         };
        break;

      case 'commandOverheatprotectionLevel':
        let cop_temp = 1;
        if (params.level == 'low'){
          cop_temp = 1;
        }
        else if (params.level == 'medium'){
          cop_temp = 2;
        }
        else if (params.level == 'high'){
          cop_temp = 3;
        }
    
        result.command = 'setCopTempAction';
        result.params = {
          copActivationTemp: cop_temp
        };
        break;
  
      case 'commandDefrost':
        result.command = 'hvacSetPreconditioningMaxAction';
        result.params = {
          on: params.on
        };
        break;

      case 'commandSteeringWheelHeatLevel':
        result.command = 'hvacSteeringWheelHeaterAction';
        result.params = {
          power_on: (params.level != 0)
        };
        break;

      // case 'commandSeatHeatLevel':
      //   if (params.level == 'auto'){
      //     result.command = 'autoSeatClimateAction';
      //     result.params = {
      //       on: true,
      //       seat_position : params.seat
      //     };
      //   }
      //   else{
      //     result.command = 'hvacSeatHeaterActions';
      //     result.params = {
      //       on: true,
      //       seat_position : params.seat
      //     };
      //   }
      //   break;
          

      // error if not valid
      default:
        throw new Error("REST command "+apiFunction+" not supported yet for direct CommandProtocol");
    }
    return result;
  }

  async _commandPing(){
    await this.sendCommand('ping', {});
  }

  async _commandSentryMode(state){
    await this.sendCommand('commandSentryMode', {state});
  }

  async _commandDoorLock(locked){
    await this.sendCommand('commandDoorLock', {locked});
  }

  async _commandFlashLights(){
    await this.sendCommand('commandFlashLights', {});
  }

  async _commandHonkHorn(){
    await this.sendCommand('commandHonkHorn', {});
  }

  async _commandWindowPosition(position){
    await this.sendCommand('commandWindowPosition', {position});
  }

  async _commandScheduleSoftwareUpdate(minutes){
    await this.sendCommand('commandScheduleSoftwareUpdate', {minutes});
  }

  async _commandTrunk(trunk){
    await this.sendCommand('commandTrunk', {trunk});
  }

  // CAPABILITIES =======================================================================================

  async _onCapability( capabilityValues, capabilityOptions){
    this.log("_onCapability(): ", capabilityValues, capabilityOptions);

    if( capabilityValues["car_refresh"] != undefined){
      await this._sync();      
    }

    if( capabilityValues["car_wake_up"] != undefined){
      await this._wakeUp(true);
    }

    if( capabilityValues["car_doors_locked"] != undefined){
      await this._commandDoorLock(!capabilityValues["car_doors_locked"]);
    }

    if( capabilityValues["car_sentry_mode"] != undefined){
      await this._commandSentryMode(capabilityValues["car_sentry_mode"]);
    }

    if( capabilityValues["car_trunk_front"] != undefined){
      if (this._settings.car_trunk){
        await this.setCapabilityValue("car_trunk_front", true);
        await this._commandTrunk(CONSTANTS.TRUNK_FRONT);
      }
      else{
        throw new Error(this.homey.__('devices.car.trunk_not_allowed'));
      }
    }

    if( capabilityValues["car_trunk_rear"] != undefined){
      if (this._settings.car_trunk){
        await this.setCapabilityValue("car_trunk_rear", !this.getCapabilityValue("car_trunk_rear"));
        await this._commandTrunk(CONSTANTS.TRUNK_REAR);
      }
      else{
        throw new Error(this.homey.__('devices.car.trunk_not_allowed'));
      }
    }

  }

  // FLOW ACTIONS =======================================================================================

  async flowActionPing(){
    await this._commandPing();
  }

  async flowActionRefresh(){
    await this._sync();
  }

  async flowActionWakeUp(wait=true){
    return await this._wakeUp(wait);
  }

  async flowActionDoorLock(locked){
    await this._commandDoorLock(locked);
    this.setCapabilityValue('car_doors_locked', locked);
  }

  async flowActionSentryMode(state){
    await this._commandSentryMode(!state);
    this.setCapabilityValue('car_sentry_mode', !state);
  }

  async flowActionFlashLights(){
    await this._commandFlashLights();
  }

  async flowActionHonkHorn(){
    await this._commandHonkHorn();
  }

  async flowActionWindowPosition(position){
    await this._commandWindowPosition(position);
  }

  async flowActionScheduleSoftwareUpdate(minutes){
    await this._commandScheduleSoftwareUpdate(minutes);
  }

  async flowActionTrunk(trunk){
    await this._commandTrunk(trunk);
  }

}