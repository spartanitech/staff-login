package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Status;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record WorkLocationRequest(
        @NotBlank(message = "Name is required") @Size(max = 120) String name,
        @Size(max = 255) String address,
        @NotNull(message = "latitude is required") @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull(message = "longitude is required") @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @NotNull(message = "allowedRadiusMeters is required")
        @Min(value = 10, message = "Radius must be at least 10 m") @Max(value = 5000, message = "Radius cannot exceed 5000 m") Integer allowedRadiusMeters,
        Status status) {
}
