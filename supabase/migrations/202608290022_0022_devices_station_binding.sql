-- 0022_devices_station_binding
-- Section 04/05: bar/kitchen display tablets are bound to one physical
-- station (spec's own example has multiple bar stations — bar-main,
-- bar-vip — each needing its own queue). devices had no way to
-- represent this.

ALTER TABLE public.devices
  ADD COLUMN station_id uuid REFERENCES public.stations (id);
