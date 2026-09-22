package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;

public record ShopResponse(Long id, String code, String name, String locality, String region, String address, String phone,
                           double latitude, double longitude, int allowedRadiusMeters, Status status,
                           Long assignedOfficerId, String assignedOfficerName) {

    public static ShopResponse from(Shop s) {
        User o = s.getAssignedOfficer();
        return new ShopResponse(s.getId(), s.getCode(), s.getName(), s.getLocality(), s.getRegion(), s.getAddress(), s.getPhone(),
                s.getLatitude(), s.getLongitude(), s.getAllowedRadiusMeters(), s.getStatus(),
                o == null ? null : o.getId(), o == null ? null : o.getName());
    }
}
