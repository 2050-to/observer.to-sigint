#include <napi.h>
#include <CoreWLAN/CoreWLAN.h>
#include <CoreBluetooth/CoreBluetooth.h>
#include <CoreLocation/CoreLocation.h>
#include <AppKit/AppKit.h>
#include <string>

static Napi::ThreadSafeFunction tsfn;
static bool tsfnActive = false;

static NSString *JsonString(id object) {
  if (!object || object == [NSNull null]) return @"null";
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  if (!data) return @"{}";
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSDictionary *NetworkJson(CWNetwork *network);

static void Emit(NSDictionary *payload) {
  if (!tsfnActive) return;
  std::string *copy = new std::string(JsonString(payload).UTF8String);
  tsfn.BlockingCall(copy, [](Napi::Env env, Napi::Function callback, std::string *value) {
    callback.Call({Napi::String::New(env, *value)});
    delete value;
  });
}

static int FrequencyFor(NSInteger channel, CWChannelBand band) {
  if (band == kCWChannelBand2GHz) {
    if (channel == 14) return 2484;
    if (channel >= 1 && channel <= 13) return 2407 + (int)channel * 5;
  } else if (band == kCWChannelBand5GHz) {
    return 5000 + (int)channel * 5;
  } else if (band == kCWChannelBand6GHz) {
    if (channel == 2) return 5935;
    return 5950 + (int)channel * 5;
  }
  return 0;
}

static NSString *BandName(CWChannelBand band) {
  if (band == kCWChannelBand2GHz) return @"2.4";
  if (band == kCWChannelBand5GHz) return @"5";
  if (band == kCWChannelBand6GHz) return @"6";
  return @"unknown";
}

static int WidthMhz(CWChannelWidth width) {
  switch (width) {
    case kCWChannelWidth40MHz: return 40;
    case kCWChannelWidth80MHz: return 80;
    case kCWChannelWidth160MHz: return 160;
    default: return 20;
  }
}

static BOOL LocallyAdministered(NSString *address) {
  unsigned value = 0;
  NSScanner *scanner = [NSScanner scannerWithString:[address substringToIndex:2]];
  [scanner scanHexInt:&value];
  return (value & 0x02) != 0;
}

static BOOL Matches(NSString *address, NSString *expression) {
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:expression options:NSRegularExpressionCaseInsensitive error:nil];
  return [pattern numberOfMatchesInString:address options:0 range:NSMakeRange(0, address.length)] == 1;
}

static BOOL MacAddress(NSString *address) {
  return Matches(address, @"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$");
}

static BOOL DeviceKey(NSString *address) {
  return MacAddress(address) || Matches(address, @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
}

static NSString *FullUuid(CBUUID *uuid) {
  NSString *text = uuid.UUIDString.lowercaseString;
  if (text.length == 4) return [NSString stringWithFormat:@"0000%@-0000-1000-8000-00805f9b34fb", text];
  if (text.length == 8) return [NSString stringWithFormat:@"%@-0000-1000-8000-00805f9b34fb", text];
  return text;
}

static BOOL LocationGranted(CLAuthorizationStatus status) {
  return status == kCLAuthorizationStatusAuthorizedAlways;
}

static BOOL BluetoothGranted(void) {
  return [CBManager authorization] == CBManagerAuthorizationAllowedAlways;
}

static BOOL AsksFor(NSString *status, NSString *permission) {
  return [status rangeOfString:permission].location != NSNotFound;
}

@interface RadioScanner : NSObject <CBCentralManagerDelegate, CLLocationManagerDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) CLLocationManager *locationManager;
@property(nonatomic, strong) CLLocation *location;
@property(nonatomic, strong) NSNumber *referenceAltitude;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *adverts;
@property(nonatomic, strong) dispatch_source_t timer;
@property(nonatomic, assign) BOOL active;
@property(nonatomic, assign) BOOL scanning;
@property(nonatomic, assign) BOOL askedWhenInUse;
@property(nonatomic, assign) BOOL openedLocationSettings;
@property(nonatomic, assign) BOOL askedBluetooth;
@property(nonatomic, assign) BOOL openedBluetoothSettings;
@property(nonatomic, assign) int periodMs;
- (void)startScanning;
- (void)stop;
- (void)setPeriod:(int)ms;
@end

@implementation RadioScanner

- (instancetype)init {
  self = [super init];
  if (!self) return nil;
  _adverts = [NSMutableDictionary dictionary];
  _periodMs = 30000;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue() options:@{
      CBCentralManagerOptionShowPowerAlertKey: @NO,
    }];
    self.locationManager = [[CLLocationManager alloc] init];
    self.locationManager.delegate = self;
    self.locationManager.desiredAccuracy = kCLLocationAccuracyBest;
  });
  return self;
}

- (void)startScanning {
  self.active = YES;
  self.referenceAltitude = nil;
  self.askedWhenInUse = NO;
  self.openedLocationSettings = NO;
  self.askedBluetooth = NO;
  self.openedBluetoothSettings = NO;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self ensureRadios];
    [NSApp activateIgnoringOtherApps:YES];
    if ([self.locationManager authorizationStatus] == kCLAuthorizationStatusNotDetermined) {
      [self.locationManager requestWhenInUseAuthorization];
    }
    [self.locationManager startUpdatingLocation];
    if (self.central.state == CBManagerStatePoweredOn) {
      [self.central scanForPeripheralsWithServices:nil options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @YES}];
    }
  });
  dispatch_queue_t queue = dispatch_queue_create("com.wifimapping.scan", DISPATCH_QUEUE_SERIAL);
  dispatch_async(queue, ^{
    [self scanOnce];
  });
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  self.timer = timer;
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)self.periodMs * NSEC_PER_MSEC), (uint64_t)self.periodMs * NSEC_PER_MSEC, NSEC_PER_SEC);
  __weak RadioScanner *weakSelf = self;
  dispatch_source_set_event_handler(timer, ^{
    [weakSelf scanOnce];
  });
  dispatch_resume(timer);
}

- (void)stop {
  self.active = NO;
  self.referenceAltitude = nil;
  dispatch_source_t timer = self.timer;
  self.timer = nil;
  if (timer) dispatch_source_cancel(timer);
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.central stopScan];
    [self.locationManager stopUpdatingLocation];
  });
}

- (void)setPeriod:(int)ms {
  if (ms < 30000) ms = 30000;
  self.periodMs = ms;
  if (!self.timer) return;
  dispatch_source_set_timer(self.timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)ms * NSEC_PER_MSEC), (uint64_t)ms * NSEC_PER_MSEC, NSEC_PER_SEC);
}

- (void)scanOnce {
  if (!self.active || self.scanning) return;
  self.scanning = YES;
  NSDictionary *payload = nil;
  @try {
    payload = [self collect];
  } @catch (NSException *exception) {
    payload = @{
      @"wifiOn": @NO,
      @"bluetoothOn": @NO,
      @"cellOn": @NO,
      @"networks": @[],
      @"devices": @[],
      @"cells": @[],
      @"message": exception.reason ?: @"Wi-Fi scan failed.",
    };
  }
  self.scanning = NO;
  if (self.active && payload) Emit(payload);
}

- (NSDictionary *)collect {
  __block BOOL bluetoothOn = NO;
  __block BOOL locationAllowed = NO;
  __block NSString *status = @"Scanning nearby networks.";
  void (^readRadios)(void) = ^{
    bluetoothOn = self.central.state == CBManagerStatePoweredOn;
    CLAuthorizationStatus authorization = self.locationManager.authorizationStatus;
    locationAllowed = LocationGranted(authorization);
    status = [self statusMessage];
  };
  if ([NSThread isMainThread]) readRadios();
  else dispatch_sync(dispatch_get_main_queue(), readRadios);
  CWInterface *iface = [CWWiFiClient sharedWiFiClient].interface;
  BOOL wifiOn = iface.powerOn;
  NSArray *devices = [self takeDevices];
  if (!iface || !wifiOn) {
    return @{
      @"wifiOn": @NO,
      @"bluetoothOn": @(bluetoothOn),
      @"cellOn": @NO,
      @"networks": @[],
      @"devices": devices,
      @"cells": @[],
      @"message": @"Wi-Fi is off.",
    };
  }
  NSError *error = nil;
  NSSet<CWNetwork *> *found = [iface scanForNetworksWithSSID:nil includeHidden:YES error:&error];
  if (!found) {
    return @{
      @"wifiOn": @YES,
      @"bluetoothOn": @(bluetoothOn),
      @"cellOn": @NO,
      @"networks": @[],
      @"devices": devices,
      @"cells": @[],
      @"message": error.localizedDescription ?: @"Wi-Fi scan failed.",
    };
  }
  NSMutableArray *networks = [NSMutableArray array];
  for (CWNetwork *network in found) {
    NSDictionary *entry = NetworkJson(network);
    if (entry) [networks addObject:entry];
  }
  if (networks.count == 0) {
    status = locationAllowed
      ? @"No Wi-Fi networks were found."
      : [NSString stringWithFormat:@"macOS hid %lu networks. Allow Location for Observer.to to show names and addresses.", (unsigned long)found.count];
  }
  if (!BluetoothGranted() && !AsksFor(status, @"Allow Location") && [status isEqualToString:@"Scanning nearby networks."]) {
    status = @"Allow Bluetooth for Observer.to to read nearby advertisements.";
  }
  [self promptForStatus:status];
  NSMutableDictionary *payload = [@{
    @"wifiOn": @YES,
    @"bluetoothOn": @(bluetoothOn),
    @"cellOn": @NO,
    @"networks": networks,
    @"devices": devices,
    @"cells": @[],
    @"message": status,
  } mutableCopy];
  [self addLocation:payload];
  return payload;
}

- (NSString *)statusMessage {
  CLAuthorizationStatus status = self.locationManager.authorizationStatus;
  if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted || status == kCLAuthorizationStatusNotDetermined) {
    return @"Scanning. Allow Location to record where networks were heard.";
  }
  return @"Scanning nearby networks.";
}

- (void)ensureRadios {
  if (!self.locationManager) {
    self.locationManager = [[CLLocationManager alloc] init];
    self.locationManager.delegate = self;
    self.locationManager.desiredAccuracy = kCLLocationAccuracyBest;
  }
  if (!self.central) {
    self.central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue() options:@{
      CBCentralManagerOptionShowPowerAlertKey: @NO,
    }];
  }
}

- (void)openPrivacyPane:(NSString *)anchor {
  NSString *link = [NSString stringWithFormat:@"x-apple.systempreferences:com.apple.preference.security?%@", anchor];
  NSURL *url = [NSURL URLWithString:link];
  if (!url) return;
  [[NSWorkspace sharedWorkspace] openURL:url configuration:[NSWorkspaceOpenConfiguration configuration] completionHandler:nil];
}

- (void)promptLocationOnMain {
  [self ensureRadios];
  CLAuthorizationStatus status = self.locationManager.authorizationStatus;
  if (LocationGranted(status)) {
    self.openedLocationSettings = NO;
    return;
  }
  if (status == kCLAuthorizationStatusNotDetermined) {
    if (!self.askedWhenInUse) {
      self.askedWhenInUse = YES;
      [NSApp activateIgnoringOtherApps:YES];
    }
    [self.locationManager requestWhenInUseAuthorization];
    return;
  }
  if (self.openedLocationSettings) return;
  self.openedLocationSettings = YES;
  [NSApp activateIgnoringOtherApps:YES];
  [self openPrivacyPane:@"Privacy_LocationServices"];
}

- (void)promptBluetoothOnMain {
  [self ensureRadios];
  CBManagerAuthorization auth = [CBManager authorization];
  if (auth == CBManagerAuthorizationAllowedAlways) {
    self.openedBluetoothSettings = NO;
    return;
  }
  if (auth == CBManagerAuthorizationNotDetermined) {
    if (self.askedBluetooth) return;
    self.askedBluetooth = YES;
    [NSApp activateIgnoringOtherApps:YES];
    [self.central stopScan];
    self.central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue() options:@{
      CBCentralManagerOptionShowPowerAlertKey: @NO,
    }];
    return;
  }
  if (self.openedBluetoothSettings) return;
  self.openedBluetoothSettings = YES;
  [NSApp activateIgnoringOtherApps:YES];
  [self openPrivacyPane:@"Privacy_Bluetooth"];
}

- (void)promptForStatus:(NSString *)status {
  BOOL location = AsksFor(status, @"Allow Location");
  BOOL bluetooth = AsksFor(status, @"Allow Bluetooth");
  if (!location && !bluetooth) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (location) [self promptLocationOnMain];
    if (bluetooth) [self promptBluetoothOnMain];
  });
}

- (void)addLocation:(NSMutableDictionary *)payload {
  CLLocation *fix = nil;
  @synchronized (self) {
    fix = self.location;
  }
  if (!fix) return;
  payload[@"lat"] = @(fix.coordinate.latitude);
  payload[@"lon"] = @(fix.coordinate.longitude);
  if (fix.horizontalAccuracy >= 0) payload[@"accuracy"] = @(fix.horizontalAccuracy);
  if (fix.verticalAccuracy >= 0) {
    payload[@"altitudeM"] = @(fix.altitude);
    payload[@"verticalAccuracyM"] = @(fix.verticalAccuracy);
    if (!self.referenceAltitude) self.referenceAltitude = @(fix.altitude);
    payload[@"relativeM"] = @(fix.altitude - self.referenceAltitude.doubleValue);
  }
  if (fix.speed >= 0) payload[@"speedMps"] = @(fix.speed);
}

- (NSArray *)takeDevices {
  NSArray *devices;
  @synchronized (self.adverts) {
    devices = self.adverts.allValues;
    [self.adverts removeAllObjects];
  }
  return devices ?: @[];
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (central.state == CBManagerStatePoweredOn && self.active) {
    [central scanForPeripheralsWithServices:nil options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @YES}];
  }
}

- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)peripheral advertisementData:(NSDictionary<NSString *, id> *)advertisementData RSSI:(NSNumber *)RSSI {
  (void)central;
  NSString *address = peripheral.identifier.UUIDString.lowercaseString;
  if (!DeviceKey(address)) return;
  id name = advertisementData[CBAdvertisementDataLocalNameKey];
  id tx = advertisementData[CBAdvertisementDataTxPowerLevelKey];
  NSMutableArray *uuids = [NSMutableArray array];
  for (CBUUID *uuid in advertisementData[CBAdvertisementDataServiceUUIDsKey]) {
    [uuids addObject:FullUuid(uuid)];
  }
  NSString *addressType = MacAddress(address) && !LocallyAdministered(address) ? @"public" : @"random";
  NSMutableDictionary *device = [@{
    @"address": address,
    @"addressType": addressType,
    @"rssi": RSSI ?: @0,
    @"serviceUuids": uuids,
  } mutableCopy];
  device[@"name"] = [name isKindOfClass:[NSString class]] && [name length] ? name : [NSNull null];
  if ([tx isKindOfClass:[NSNumber class]] && [tx intValue] != 127) device[@"txPower"] = tx;
  else device[@"txPower"] = [NSNull null];
  @synchronized (self.adverts) {
    self.adverts[address] = device;
  }
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  CLAuthorizationStatus status = manager.authorizationStatus;
  if (LocationGranted(status)) {
    self.openedLocationSettings = NO;
    if (self.active) [manager startUpdatingLocation];
  }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  (void)manager;
  CLLocation *latest = locations.lastObject;
  if (!latest) return;
  @synchronized (self) {
    self.location = latest;
  }
}

@end

static RadioScanner *SharedScanner() {
  static RadioScanner *scanner = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    scanner = [[RadioScanner alloc] init];
  });
  return scanner;
}

static NSDictionary *NetworkJson(CWNetwork *network) {
  NSString *bssid = network.bssid.lowercaseString;
  if (!bssid.length || !MacAddress(bssid)) return nil;
  CWChannel *channel = network.wlanChannel;
  int frequency = channel ? FrequencyFor(channel.channelNumber, channel.channelBand) : 0;
  NSInteger channelNumber = channel ? channel.channelNumber : 0;
  NSString *band = channel ? BandName(channel.channelBand) : @"unknown";
  int width = channel ? WidthMhz(channel.channelWidth) : 20;
  NSMutableArray *types = [NSMutableArray array];
  NSMutableArray *caps = [NSMutableArray array];
  auto add = [&](CWSecurity security, NSString *type, NSString *cap) {
    if ([network supportsSecurity:security]) {
      if (type.length) [types addObject:type];
      if (cap.length) [caps addObject:cap];
    }
  };
  add(kCWSecurityWPA3Enterprise, @"EAP", @"WPA3-ENT");
  add(kCWSecurityWPA3Personal, @"SAE", @"WPA3 SAE");
  add(kCWSecurityWPA3Transition, @"SAE", @"WPA3 SAE WPA2");
  add(kCWSecurityWPA2Enterprise, @"EAP", @"WPA2 EAP");
  add(kCWSecurityWPAEnterprise, @"EAP", @"WPA EAP");
  add(kCWSecurityEnterprise, @"EAP", @"ENTERPRISE");
  add(kCWSecurityWPAEnterpriseMixed, @"EAP", @"WPA EAP");
  add(kCWSecurityWPA2Personal, @"PSK", @"WPA2");
  add(kCWSecurityWPAPersonal, @"PSK", @"WPA");
  add(kCWSecurityWPAPersonalMixed, @"PSK", @"WPA WPA2");
  add(kCWSecurityPersonal, @"PSK", @"WPA2");
  add(kCWSecurityOWE, @"OWE", @"OWE");
  add(kCWSecurityOWETransition, @"OWE", @"OWE");
  add(kCWSecurityWEP, @"WEP", @"WEP");
  add(kCWSecurityDynamicWEP, @"WEP", @"WEP");
  if (!types.count) [types addObject:@"OPEN"];
  NSString *country = network.countryCode.length ? network.countryCode : nil;
  return @{
    @"ssid": network.ssid ?: @"",
    @"bssid": bssid,
    @"rssi": @(network.rssiValue),
    @"frequencyMhz": @(frequency),
    @"channel": @(channelNumber),
    @"band": band,
    @"channelWidthMhz": @(width),
    @"centerFreq0": @(frequency),
    @"centerFreq1": @0,
    @"wifiStandard": @"unknown",
    @"capabilities": [caps componentsJoinedByString:@" "],
    @"securityTypes": types,
    @"passpoint": @NO,
    @"responder80211mc": @NO,
    @"responder80211az": @NO,
    @"twtResponder": @NO,
    @"secureHeLtf": @NO,
    @"rangingFrameProtection": @NO,
    @"apMldMac": [NSNull null],
    @"apMloLinkId": [NSNull null],
    @"affiliatedLinks": @[],
    @"operatorName": [NSNull null],
    @"venueName": [NSNull null],
    @"countryCode": country ?: (id)[NSNull null],
    @"maxRateMbps": [NSNull null],
    @"stationCount": [NSNull null],
    @"channelUtilization": [NSNull null],
    @"admissionCapacity": [NSNull null],
    @"vendorOuis": @[],
  };
}

static void Start(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start expects a callback").ThrowAsJavaScriptException();
    return;
  }
  if (tsfnActive) {
    [SharedScanner() stop];
    tsfn.Release();
    tsfnActive = false;
  }
  tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "scan", 0, 1);
  tsfnActive = true;
  [SharedScanner() startScanning];
}

static void Stop(const Napi::CallbackInfo &) {
  [SharedScanner() stop];
  if (tsfnActive) {
    tsfn.Release();
    tsfnActive = false;
  }
}

static void SetPeriod(const Napi::CallbackInfo &info) {
  int ms = info.Length() ? info[0].As<Napi::Number>().Int32Value() : 30000;
  [SharedScanner() setPeriod:ms];
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("setPeriod", Napi::Function::New(env, SetPeriod));
  return exports;
}

NODE_API_MODULE(scanner, Init)
