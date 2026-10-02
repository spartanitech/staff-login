package com.spartan.attendance.repository;

import com.spartan.attendance.entity.SalesOrder;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SalesOrderRepository extends JpaRepository<SalesOrder, Long> {

    Optional<SalesOrder> findByOfficerIdAndClientRef(Long officerId, String clientRef);

    List<SalesOrder> findByOrderDateBetweenOrderByOrderDateDescIdDesc(LocalDate from, LocalDate to);

    List<SalesOrder> findByOfficerIdInAndOrderDateBetweenOrderByOrderDateDescIdDesc(Collection<Long> officerIds, LocalDate from, LocalDate to);

    @Modifying
    @Query("delete from SalesOrder o where o.officer.id = :userId")
    int deleteByOfficerId(@Param("userId") Long userId);
}
