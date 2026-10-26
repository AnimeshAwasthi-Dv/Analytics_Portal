import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DesktopLicense } from "../services/api";

// Custom pin marker icon using Leaflet DivIcon for crisp, asset-independent rendering
const customPinIcon = L.divIcon({
  className: "custom-geo-marker",
  html: `<div class="geo-marker-pin"><div class="geo-marker-dot"></div></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
  popupAnchor: [0, -26],
});

// Helper component to auto-fit map bounds when markers change
function MapAutoBounds({ markers }: { markers: DesktopLicense[] }) {
  const map = useMap();

  useEffect(() => {
    // Invalidate map size after mount/render to ensure all tiles render correctly
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    if (!markers.length) {
      clearTimeout(resizeTimer);
      return;
    }

    if (markers.length === 1) {
      const lat = markers[0].latitude!;
      const lng = markers[0].longitude!;
      map.setView([lat, lng], 13, { animate: true });
    } else {
      const bounds = L.latLngBounds(
        markers.map(m => [m.latitude!, m.longitude!] as [number, number])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    }

    return () => clearTimeout(resizeTimer);
  }, [markers, map]);

  return null;
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

interface GeoLocationMapProps {
  licenses: DesktopLicense[];
}

export function GeoLocationMap({ licenses }: GeoLocationMapProps) {
  // Validate coordinates before plotting
  const validLicenses = useMemo(() => {
    return licenses.filter(x => isValidCoordinate(x.latitude, x.longitude));
  }, [licenses]);

  if (validLicenses.length === 0) {
    return (
      <div className="license-geo-map license-geo-map-empty" role="img" aria-label="No license coordinates recorded yet">
        <p>No license coordinates recorded yet.</p>
      </div>
    );
  }

  // Initial center based on first marker or India default
  const initialCenter: [number, number] = [
    validLicenses[0].latitude!,
    validLicenses[0].longitude!,
  ];

  return (
    <div className="license-geo-map" role="region" aria-label="Interactive license geo location map">
      <MapContainer
        center={initialCenter}
        zoom={validLicenses.length === 1 ? 13 : 5}
        scrollWheelZoom={true}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapAutoBounds markers={validLicenses} />
        {validLicenses.map(x => {
          const lat = x.latitude!;
          const lng = x.longitude!;
          const userDisplay = x.fullName || x.username || "—";
          const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

          return (
            <Marker key={x.id} position={[lat, lng]} icon={customPinIcon}>
              <Popup className="geo-license-popup">
                <div className="geo-popup-card">
                  <h3 className="geo-popup-title">{x.licenseKey}</h3>
                  <div className="geo-popup-grid">
                    <span>Organisation</span>
                    <strong>{x.vendor || "Unassigned"}</strong>

                    <span>Platform</span>
                    <strong>{x.platform}</strong>

                    <span>Status</span>
                    <span>
                      <span className="license-status">{x.status}</span>
                    </span>

                    <span>Credits left</span>
                    <strong>{x.creditsRemaining.toLocaleString()}</strong>

                    <span>Coordinates</span>
                    <code>{lat.toFixed(4)}, {lng.toFixed(4)}</code>

                    <span>User</span>
                    <strong>{userDisplay}</strong>
                  </div>
                  <a
                    href={gmapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="geo-popup-btn"
                  >
                    Open in Google Maps ↗
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
