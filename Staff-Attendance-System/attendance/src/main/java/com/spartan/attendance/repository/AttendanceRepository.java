package com.spartan.attendance.repository;

import com.spartan.attendance.entity.Attendance;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AttendanceRepository extends JpaRepository<Attendance, Long>, JpaSpecificationExecutor<Attendance> {

    @Query("select a from Attendance a left join fetch a.workLocation left join fetch a.shop where a.user.id = :userId and a.attendanceDate = :date")
    Optional<Attendance> findForUserOnDate(@Param("userId") Long userId, @Param("date") LocalDate date);

    /** Same as the inherited findAll(spec, sort) but loads user + work location in the same query (no N+1). */
    @Override
    @EntityGraph(attributePaths = {"user", "workLocation", "shop"})
    List<Attendance> findAll(Specification<Attendance> spec, Sort sort);

    /** Used when permanently deleting a user: their own attendance history goes with them. */
    long deleteByUserId(Long userId);

    /** Used when permanently deleting a shop: the attendance day itself is kept, only the shop link is dropped. */
    @Modifying
    @Query("update Attendance a set a.shop = null where a.shop.id = :shopId")
    int clearShopReferences(@Param("shopId") Long shopId);
}
