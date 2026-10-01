package com.spartan.attendance.repository;

import com.spartan.attendance.entity.DailyReport;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DailyReportRepository extends JpaRepository<DailyReport, Long> {

    Optional<DailyReport> findByOfficerIdAndReportDate(Long officerId, LocalDate date);

    List<DailyReport> findByOfficerIdAndReportDateBetweenOrderByReportDateAsc(Long officerId, LocalDate from, LocalDate to);
}
