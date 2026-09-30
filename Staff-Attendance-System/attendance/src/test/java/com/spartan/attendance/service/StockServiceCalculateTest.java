package com.spartan.attendance.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class StockServiceCalculateTest {

    @Test
    void totalStockTotalSalesAndClosing() {
        StockService.StockTotals t = StockService.calculate(100, 50, 30, 20);
        assertEquals(150, t.totalStock());   // Opening + Receipt
        assertEquals(50, t.totalSales());    // SO Sales + DP Sales
        assertEquals(100, t.closing());      // Total Stock - Total Sales
    }

    @Test
    void nothingMovedKeepsTheOpening() {
        StockService.StockTotals t = StockService.calculate(42, 0, 0, 0);
        assertEquals(42, t.totalStock());
        assertEquals(0, t.totalSales());
        assertEquals(42, t.closing());
    }
}
