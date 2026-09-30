package com.spartan.attendance.dto;

import com.spartan.attendance.entity.DpName;

public record DpNameResponse(Long id, String name) {

    public static DpNameResponse from(DpName d) {
        return new DpNameResponse(d.getId(), d.getName());
    }
}
