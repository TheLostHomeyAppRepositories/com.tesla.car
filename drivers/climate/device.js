"use strict";
const Homey = require('homey');

const CONSTANTS = require('../../lib/constants');
const ChildDevice = require('../child_device');

module.exports = class ClimateDevice extends ChildDevice {

  async onInit() {
    await super.onInit();
  }

  // Device handling =======================================================================================
  getCarDevice(){
    let device = this.homey.drivers.getDriver('car').getDevices().filter(e=>{ return ( e.getData().id == this.getData().id ) })[0];
    if (device == undefined){
      throw new Error('No car device found.');
    }
    return device; 
  }

  // SYNC =======================================================================================
  async updateDevice(data){
    await super.updateDevice(data);

    // window state
    // vent mode is not direclty readable. Only windows open/closed can be checked.
    if (this.hasCapability('climate_window_vent') && data.vehicle_state && 
        data.vehicle_state.fd_window == 0 && // front driver window 0=clodes
        data.vehicle_state.rd_window == 0 && // read driver window 0=clodes
        data.vehicle_state.fp_window == 0 && // front passenger window 0=clodes
        data.vehicle_state.rp_window == 0    // rear passenger window 0=clodes
      ){
      await this.setCapabilityValue('climate_window_vent', false);
    }
    else{
      await this.setCapabilityValue('climate_window_vent', true);
    }    

    // Temperatures
    if (this.hasCapability('target_temperature') && data.climate_state && data.climate_state.driver_temp_setting != undefined){
      await this.setCapabilityValue('target_temperature', data.climate_state.driver_temp_setting );
    }
    if (this.hasCapability('measure_temperature') && data.climate_state && data.climate_state.inside_temp ){
      await this.setCapabilityValue('measure_temperature', data.climate_state.inside_temp );
    }
    if (this.hasCapability('measure_climate_temperature_in') && data.climate_state && data.climate_state.inside_temp != undefined){
      await this.setCapabilityValue('measure_climate_temperature_in', data.climate_state.inside_temp );
    }
    if (this.hasCapability('measure_climate_temperature_out') && data.climate_state && data.climate_state.outside_temp != undefined){
      await this.setCapabilityValue('measure_climate_temperature_out', data.climate_state.outside_temp );
    }

    // Adjust temperature capabilities
    if (this.hasCapability('target_temperature')){
      let options = this.getCapabilityOptions('target_temperature');
      if (options.min != data.climate_state.min_avail_temp){
        options.min = data.climate_state.min_avail_temp;
        this.setCapabilityOptions('target_temperature', options );
      }
      if (options.max != data.climate_state.max_avail_temp){
        options.max = data.climate_state.max_avail_temp;
        this.setCapabilityOptions('target_temperature', options );
      }
    }

    // A/C
    if (this.hasCapability('climate_ac') && data.climate_state && data.climate_state.is_climate_on != undefined){
      await this.setCapabilityValue('climate_ac', data.climate_state.is_climate_on );
    }
    if (this.hasCapability('climate_ac_auto') && data.climate_state && data.climate_state.is_auto_conditioning_on != undefined){
      await this.setCapabilityValue('climate_ac_auto', data.climate_state.is_auto_conditioning_on );
    }

    // Preconditioning
    if (this.hasCapability('climate_preconditioning') && data.climate_state && data.climate_state.is_preconditioning != undefined){
      await this.setCapabilityValue('climate_preconditioning', data.climate_state.is_preconditioning );
    }
    if (this.hasCapability('climate_defrost') && data.climate_state && data.climate_state.defrost_mode != undefined){
      await this.setCapabilityValue('climate_defrost', (data.climate_state.defrost_mode != 0) );
    }

    // Overheat protection
    if (this.hasCapability('climate_overheat_protection_mode') && data.climate_state && data.climate_state.cabin_overheat_protection != undefined){
      if (data.climate_state.cabin_overheat_protection == 'FanOnly'){
        await this.setCapabilityValue('climate_overheat_protection_mode', 'fan_only' );
      }
      else if (data.climate_state.cabin_overheat_protection == 'On'){
        await this.setCapabilityValue('climate_overheat_protection_mode', 'on' );
      }
      else if (data.climate_state.cabin_overheat_protection == 'Off'){
        await this.setCapabilityValue('climate_overheat_protection_mode', 'off' );
      }
    }
    if (this.hasCapability('climate_overheat_protection_level') && data.climate_state && data.climate_state.cop_activation_temperature != undefined){
      if (data.climate_state.cop_activation_temperature == 'Low'){
        await this.setCapabilityValue('climate_overheat_protection_level', 'low' );
      }
      else if (data.climate_state.cop_activation_temperature == 'Medium'){
        await this.setCapabilityValue('climate_overheat_protection_level', 'medium' );
      }
      else if (data.climate_state.cop_activation_temperature == 'High'){
        await this.setCapabilityValue('climate_overheat_protection_level', 'high' );
      }
    }

    // Steering wheel heating
    if (this.hasCapability('climate_steering_wheel_heat_level') && 
        data.climate_state && 
        data.climate_state.auto_steering_wheel_heat != undefined && 
        data.climate_state.steering_wheel_heat_level != undefined){
      let value = data.climate_state.steering_wheel_heat_level.toString();
      // 1 = Level 1
      // 3 = LEvel 2
      if (data.climate_state.auto_steering_wheel_heat == true){
        value = value + '-auto';
      }
      await this.setCapabilityValue('climate_steering_wheel_heat_level', value );
    }

    // driver seat heating
    if (this.hasCapability('climate_seat_fl_heat_level') && 
        data.climate_state && 
        data.climate_state.auto_seat_climate_left != undefined && 
        data.climate_state.seat_heater_left != undefined){
      let value = data.climate_state.seat_heater_left.toString();
      // 1 = Level 1
      // 2 = Level 2
      // 3 = LEvel 3
      if (data.climate_state.auto_seat_climate_left == true){
        value = value + '-auto';
      }
      await this.setCapabilityValue('climate_seat_fl_heat_level', value );
    }

    // driver seat heating
    if (this.hasCapability('climate_seat_fr_heat_level') && 
        data.climate_state && 
        data.climate_state.auto_seat_climate_right != undefined && 
        data.climate_state.seat_heater_right != undefined){
      let value = data.climate_state.seat_heater_right.toString();
      // 1 = Level 1
      // 2 = Level 2
      // 3 = LEvel 3
      if (data.climate_state.auto_seat_climate_right == true){
        value = value + '-auto';
      }
      await this.setCapabilityValue('climate_seat_fr_heat_level', value );
    }

  }

  
  // Commands =======================================================================================
  async _commandWindowPosition(position){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandWindowPosition(this.getCarDevice().getCommandApi(), this.getData().id, position);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandSetTemperature(driverTemperature, passengerTemperature){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandSetTemperature(this.getCarDevice().getCommandApi(), this.getData().id, driverTemperature, passengerTemperature);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandPreconditioning(on){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandPreconditioning(this.getCarDevice().getCommandApi(), this.getData().id, on);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandPreconditioningMode(mode){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandPreconditioningMode(this.getCarDevice().getCommandApi(), this.getData().id, mode);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandPreconditioningLevel(level){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandPreconditioningLevel(this.getCarDevice().getCommandApi(), this.getData().id, level);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandDefrost(on){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandDefrost(this.getCarDevice().getCommandApi(), this.getData().id, on);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandSteeringWheelHeatLevel(level){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandSteeringWheelHeatLevel(this.getCarDevice().getCommandApi(), this.getData().id, level);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  async _commandSeatHeatLevel(level, seat){
    try{
      await this.getCarDevice().wakeUpIfNeeded();
      await this.getCarDevice().oAuth2Client.commandSeatHeatLevel(this.getCarDevice().getCommandApi(), this.getData().id, level, seat);
      await this.getCarDevice().handleApiOk();
    }
    catch(error){
      await this.getCarDevice().handleApiError(error);
      throw error;
    }
  }

  // CAPABILITIES =======================================================================================

  async _onCapability( capabilityValues, capabilityOptions){
    await super._onCapability( capabilityValues, capabilityOptions);

    if( capabilityValues["climate_window_vent"] != undefined){
      if (capabilityValues["climate_window_vent"]){
        await this._commandWindowPosition(CONSTANTS.WINDOW_POSITION_VENT);
      }
      else{
        await this._commandWindowPosition(CONSTANTS.WINDOW_POSITION_CLOSE);
      }
    }

    if( capabilityValues["target_temperature"] != undefined){
      await this._commandSetTemperature(
        capabilityValues["target_temperature"], // driver temp
        capabilityValues["target_temperature"]  // passenger temp
      );
    }

    if( capabilityValues["climate_preconditioning"] != undefined){
      await this._commandPreconditioning(
        capabilityValues["climate_preconditioning"]
      );
      if (!capabilityValues["climate_preconditioning"]){
        await this.setCapabilityValue('climate_defrost', false );
      }
    }

    if( capabilityValues["climate_overheat_protection_mode"] != undefined){
      await this._commandPreconditioningMode(
        capabilityValues["climate_overheat_protection_mode"]
      );
    }

    if( capabilityValues["climate_overheat_protection_level"] != undefined){
      await this._commandPreconditioningLevel(
        capabilityValues["climate_overheat_protection_level"]
      );
    }

    if( capabilityValues["climate_defrost"] != undefined){
      await this._commandDefrost(
        capabilityValues["climate_defrost"]
      );
      if (capabilityValues["climate_defrost"]){
        await this.setCapabilityValue('climate_preconditioning', true );
      }
    }

  }

  // FLOW ACTIONS =======================================================================================

  async flowActionWindowPosition(position){
    await this._commandWindowPosition(position);
    await this.setCapabilityValue('climate_window_vent', (position == CONSTANTS.WINDOW_POSITION_VENT) );
  }

  async flowActionPreconditioning(on){
    await this._commandPreconditioning(on);
    await this.setCapabilityValue('climate_preconditioning', on );
    if (!on){
      await this.setCapabilityValue('climate_defrost', false );
    }
  }

  async flowActionPreconditioningMode(mode){
    await this._commandPreconditioningMode(mode);
    await this.setCapabilityValue('climate_overheat_protection_mode', mode );
  }

  async flowActionPreconditioningLevel(level){
    await this._commandPreconditioningLevel(level);
    await this.setCapabilityValue('climate_overheat_protection_level', level );
  }

  async flowActionDefrost(on){
    await this._commandDefrost(on);
    await this.setCapabilityValue('climate_defrost', on );
    if (on){
      await this.setCapabilityValue('climate_preconditioning', true );
    }
  }

  async flowActionTemperature(temp_driver, temp_passenger){
    if (temp_passenger == undefined || temp_passenger == null){
      temp_passenger = temp_driver;
    }
    await this._commandSetTemperature(
      temp_driver, // driver temp
      temp_passenger  // passenger temp
    );
  }

  async flowActionSteeringWheelHeatLevel(level){
    await this._commandSteeringWheelHeatLevel(level);
    // await this.setCapabilityValue('climate_steering_wheel_heat_level', level );
  }

  async flowActionSeatHeatLevel(level, seat){
    await this._commandSeatHeatLevel(level, seat);
    // await this.setCapabilityValue('climate_seat_heat_level', level );
  }

}