package com.spartan.attendance.repository;

import com.spartan.attendance.entity.StockEntry;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockEntryRepository extends JpaRepository<StockEntry, Long> {

    List<StockEntry> findByOfficerIdAndEntryDateBetweenOrderByEntryDateAscIdAsc(Long officerId, LocalDate from, LocalDate to);

    Optional<StockEntry> findByOfficerIdAndEntryDateAndProduct(Long officerId, LocalDate date, String product);

    /** For every product, the officer's most recent entry strictly before the given day (its closing = that day's opening). */
    @Query("select e from StockEntry e where e.officer.id = :officerId and e.entryDate = "
            + "(select max(e2.entryDate) from StockEntry e2 where e2.officer.id = :officerId "
            + "and e2.product = e.product and e2.entryDate < :date)")
    List<StockEntry> findLatestBefore(@Param("officerId") Long officerId, @Param("date") LocalDate date);

    @Query("select e from StockEntry e join fetch e.officer where e.entryDate between :from and :to order by e.entryDate asc, e.id asc")
    List<StockEntry> findAllBetween(@Param("from") LocalDate from, @Param("to") LocalDate to);

    boolean existsByOfficerIdAndEntryDateAndProduct(Long officerId, LocalDate date, String product);

    List<StockEntry> findByOfficerIdAndProductAndEntryDateAfterOrderByEntryDateAsc(Long officerId, String product, LocalDate date);
}
