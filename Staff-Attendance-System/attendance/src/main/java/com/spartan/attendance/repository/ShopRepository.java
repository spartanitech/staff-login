package com.spartan.attendance.repository;

import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.Status;
import java.util.List;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ShopRepository extends JpaRepository<Shop, Long>, JpaSpecificationExecutor<Shop> {

    List<Shop> findByAssignedOfficerIdAndStatusOrderByNameAsc(Long officerId, Status status);

    boolean existsByCodeIgnoreCase(String code);

    boolean existsByCodeIgnoreCaseAndIdNot(String code, Long id);

    /** Same as the inherited findAll(spec, sort) but loads the assigned officer in the same query (no N+1). */
    @Override
    @EntityGraph(attributePaths = {"assignedOfficer"})
    List<Shop> findAll(Specification<Shop> spec, Sort sort);

    /** Used when deleting a Sales Officer: their shops stay, just become unassigned rather than blocking the delete. */
    @Modifying
    @Query("update Shop s set s.assignedOfficer = null where s.assignedOfficer.id = :officerId")
    int unassignOfficer(@Param("officerId") Long officerId);
}
