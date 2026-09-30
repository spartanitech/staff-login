package com.spartan.attendance.dto;

import com.spartan.attendance.entity.StockEntry;
import java.time.LocalDate;

public record StockEntryResponse(Long id, Long officerId, LocalDate date, String product, String category,
                                 int opening, int receipt, int soSales, int dpSales, int closing,
                                 double unitPrice, String dpName) {

    public static StockEntryResponse from(StockEntry e) {
        return new StockEntryResponse(e.getId(), e.getOfficer().getId(), e.getEntryDate(), e.getProduct(), e.getCategory(),
                e.getOpening(), e.getReceipt(), e.getSoSales(), e.getDpSales(), e.getClosing(),
                e.getUnitPrice(), e.getDpName());
    }
}
