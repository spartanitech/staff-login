package com.spartan.attendance.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/** What the device reports. Deliberately carries NO userId - the user comes from the JWT. */
public record GpsRequest(
        @NotNull(message = "latitude is required") @DecimalMin(value = "-90.0", message = "latitude must be between -90 and 90")
        @DecimalMax(value = "90.0", message = "latitude must be between -90 and 90") Double latitude,
        @NotNull(message = "longitude is required") @DecimalMin(value = "-180.0", message = "longitude must be between -180 and 180")
        @DecimalMax(value = "180.0", message = "longitude must be between -180 and 180") Double longitude,
        @NotNull(message = "accuracy is required") @PositiveOrZero(message = "accuracy cannot be negative") Double accuracy,
        @Size(max = 255) String deviceInfo) {
}
