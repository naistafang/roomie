UPDATE `bookings`
SET `status` = 'confirmed'
WHERE `id` = 18
  AND `property_id` = 5
  AND `guest_name` = '測試'
  AND `check_in` = '2026-09-14'
  AND `check_out` = '2026-09-18'
  AND `status` = 'cancelled';
