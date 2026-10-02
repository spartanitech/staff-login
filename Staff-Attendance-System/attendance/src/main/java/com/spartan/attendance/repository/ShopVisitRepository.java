package com.spartan.attendance.repository;

import com.spartan.attendance.entity.ShopVisit;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ShopVisitRepository extends JpaRepository<ShopVisit, Long> {

    List<ShopVisit> findByVisitDateBetweenOrderByVisitTimeDesc(LocalDate from, LocalDate to);

    List<ShopVisit> findByOfficerIdInAndVisitDateBetweenOrderByVisitTimeDesc(Collection<Long> officerIds, LocalDate from, LocalDate to);

    long countByOfficerIdAndVisitDate(Long officerId, LocalDate date);

    @Modifying
    @Query("delete from ShopVisit v where v.officer.id = :userId")
    int deleteByOfficerId(@Param("userId") Long userId);
}
