package com.spartan.attendance.repository;

import com.spartan.attendance.entity.CallLog;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CallLogRepository extends JpaRepository<CallLog, Long> {

    Optional<CallLog> findByClientRef(String clientRef);

    @Query("select c from CallLog c join fetch c.officer where c.officer.id in :ids "
            + "and c.callDate between :from and :to order by c.calledAt desc")
    List<CallLog> findForOfficers(@Param("ids") Collection<Long> ids, @Param("from") LocalDate from, @Param("to") LocalDate to);

    @Query("select c from CallLog c join fetch c.officer where c.callDate between :from and :to order by c.calledAt desc")
    List<CallLog> findAllBetween(@Param("from") LocalDate from, @Param("to") LocalDate to);

    @Modifying
    @Query("delete from CallLog c where c.officer.id = :userId")
    int deleteByOfficerId(@Param("userId") Long userId);
}
