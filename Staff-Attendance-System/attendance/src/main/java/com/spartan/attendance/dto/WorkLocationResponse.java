package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.WorkLocation;

public record WorkLocationResponse(Long id, String name, String address, double latitude, double longitude,
                                   int allowedRadiusMeters, Status status) {

    public static WorkLocationResponse from(WorkLocation w) {
        return new WorkLocationResponse(w.getId(), w.getName(), w.getAddress(), w.getLatitude(), w.getLongitude(),
                w.getAllowedRadiusMeters(), w.getStatus());
    }
}
