package io.github.missionaryj.patrolradar;

import android.Manifest;
import android.content.pm.PackageManager;
import android.speech.tts.TextToSpeech;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.mapbox.api.directions.v5.models.RouteOptions;
import com.mapbox.api.directions.v5.models.BannerInstructions;
import com.mapbox.geojson.Point;
import com.mapbox.navigation.base.options.NavigationOptions;
import com.mapbox.navigation.base.route.NavigationRoute;
import com.mapbox.navigation.base.route.NavigationRouterCallback;
import com.mapbox.navigation.base.route.RouterFailure;
import com.mapbox.navigation.core.MapboxNavigation;
import com.mapbox.navigation.core.MapboxNavigationProvider;
import com.mapbox.navigation.core.trip.session.RouteProgressObserver;
import com.mapbox.navigation.core.directions.session.RoutesObserver;
import com.mapbox.geojson.utils.PolylineUtils;
import com.mapbox.navigation.core.trip.session.VoiceInstructionsObserver;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Optional Mapbox SDK-backed guidance. All session work runs on the main thread.
 * A GPS trip is started only after an explicit user interaction and permissions check.
 */
@CapacitorPlugin(name = "MapboxNav")
public class MapboxNavPlugin extends Plugin {
  private MapboxNavigation nav;
  private TextToSpeech tts;
  private long generation;
  private boolean active;
  private final RoutesObserver routes = result -> {
    if (!active || result.getNavigationRoutes().isEmpty()) return;
    try {
      String encoded = result.getNavigationRoutes().get(0).getDirectionsRoute().geometry();
      if(encoded == null) return;
      List<Point> points = PolylineUtils.decode(encoded, 6);
      // Large cross-state webview transfers can jank on older Android devices.
      if(points.size() < 2 || points.size() > 6000) return;
      JSArray geometry = new JSArray();
      for(Point p : points) {
        JSArray pair = new JSArray();
        pair.put(p.longitude()); pair.put(p.latitude());
        geometry.put(pair);
      }
      JSObject output = new JSObject();
      output.put("geometry", geometry);
      notifyListeners("route", output);
    } catch(Exception ignored) { /* Keep existing displayed geometry on decode failure. */ }
  };
  private final RouteProgressObserver progress = routeProgress -> {
    JSObject state = new JSObject();
    state.put("distanceRemaining", routeProgress.getDistanceRemaining());
    state.put("durationRemaining", routeProgress.getDurationRemaining());
    // The native SDK's map-matched step and banner are authoritative for visual guidance.
    if (routeProgress.getCurrentLegProgress() != null &&
        routeProgress.getCurrentLegProgress().getCurrentStepProgress() != null) {
      state.put("distanceToTurn", routeProgress.getCurrentLegProgress().getCurrentStepProgress().getDistanceRemaining());
    }
    BannerInstructions banner = routeProgress.getBannerInstructions();
    if (banner != null && banner.primary() != null && banner.primary().text() != null) {
      state.put("instruction", banner.primary().text());
    }
    notifyListeners("progress", state);
  };
  private final VoiceInstructionsObserver voice = instructions -> {
    String announcement = instructions.announcement();
    if (announcement == null || announcement.isEmpty()) return;
    JSObject data = new JSObject();
    data.put("instruction", announcement);
    notifyListeners("voice", data);
    if (tts != null) tts.speak(announcement, TextToSpeech.QUEUE_FLUSH, null, "patrol-nav-turn");
  };
  private boolean hasLocation() {
    return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
           ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }
  @PluginMethod public void start(PluginCall call) {
    Double originLat=call.getDouble("originLat"), originLng=call.getDouble("originLng");
    Double destLat=call.getDouble("destinationLat"), destLng=call.getDouble("destinationLng");
    if (originLat==null || originLng==null || destLat==null || destLng==null ||
        !Double.isFinite(originLat) || !Double.isFinite(originLng) || !Double.isFinite(destLat) || !Double.isFinite(destLng) ||
        Math.abs(originLat)>90 || Math.abs(destLat)>90 || Math.abs(originLng)>180 || Math.abs(destLng)>180) {
      call.reject("Invalid coordinates"); return;
    }
    if (!hasLocation()) { call.reject("Location permission required"); return; }
    final long requestId=++generation;
    getActivity().runOnUiThread(() -> {
      try {
        String token=getContext().getString(R.string.mapbox_access_token);
        if (!token.startsWith("pk.")) { call.reject("Mapbox public token missing"); return; }
        stopInternal();
        nav=MapboxNavigationProvider.create(new NavigationOptions.Builder(getContext()).build());
        nav.registerRouteProgressObserver(progress);
        nav.registerRoutesObserver(routes);
        nav.registerVoiceInstructionsObserver(voice);
        tts=new TextToSpeech(getContext(), code -> {
          if (code == TextToSpeech.SUCCESS && tts != null) tts.setLanguage(Locale.US);
        });
        RouteOptions options=RouteOptions.builder()
          .coordinatesList(Arrays.asList(Point.fromLngLat(originLng,originLat),Point.fromLngLat(destLng,destLat)))
          .profile("driving-traffic")
          .steps(true).voiceInstructions(true).bannerInstructions(true)
          .alternatives(true).build();
        nav.requestRoutes(options,new NavigationRouterCallback() {
          @Override public void onRoutesReady(List<NavigationRoute> routes,String origin) {
            if(requestId!=generation || nav==null) { call.reject("Navigation request canceled");return; }
            if(routes.isEmpty()) {call.reject("No route available");return;}
            nav.setNavigationRoutes(routes);
            nav.startTripSession();
            active=true;
            JSObject result=new JSObject();result.put("active",true);result.put("alternatives",routes.size());
            call.resolve(result);
          }
          @Override public void onFailure(List<RouterFailure> reasons,RouteOptions options) {
            if(requestId==generation)call.reject("Mapbox routing failed"); else call.reject("Route canceled");
          }
          @Override public void onCanceled(RouteOptions options,String origin) {call.reject("Route request canceled");}
        });
      } catch(Exception error) { stopInternal();call.reject("Could not start native navigation: "+error.getClass().getSimpleName()); }
    });
  }
  private void stopInternal() {
    active=false;
    if(nav!=null) {
      try {nav.unregisterVoiceInstructionsObserver(voice);nav.unregisterRouteProgressObserver(progress);nav.unregisterRoutesObserver(routes);
        nav.stopTripSession();nav.setNavigationRoutes(java.util.Collections.emptyList());}
      catch(Exception ignored) { }
      MapboxNavigationProvider.destroy();nav=null;
    }
    if(tts!=null) {tts.stop();tts.shutdown();tts=null;}
  }
  @PluginMethod public void stop(PluginCall call) {
    ++generation;
    getActivity().runOnUiThread(() -> {stopInternal();call.resolve();});
  }
  @PluginMethod public void status(PluginCall call) {
    JSObject state=new JSObject();state.put("active",active);call.resolve(state);
  }
  @Override protected void handleOnDestroy() {
    ++generation;stopInternal();super.handleOnDestroy();
  }
}
