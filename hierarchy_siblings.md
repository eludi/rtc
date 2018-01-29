
<!-- concept id="loioe5db79e07e824b5a971f5b70f23f3981" -->
# HIERARCHY_SIBLINGS Navigation Function

Returns all siblings of a set of start nodes, including the start nodes.

<!-- section id="section_apc_cwn_cz" -->
## Syntax

```
HIERARCHY_SIBLINGS ( 

<hierarchy_navfunc_source_spec>
    [ <hierarchy_navfunc_start_spec> ]
)
```

<!-- section id="section_mlm_fwn_cz" -->
## Syntax Elements

### <hierarchy_navfunc_source_spec>

Specifies a hierarchy for the function to operate on.

```
<hierarchy_navfunc_source_spec> ::= SOURCE { <table_expression> | <hierarchy_generator_function> }
```

|-|-|
|`<table_expression>`|Specifies an unfiltered view or materialized result set, such as a table, containing all of the basic hierarchy attributes computed by a hierarchy generator function. A filtered result with all the basic hierarchy attributes containing the complete subtree of particular node of a hierarchy is also supported.|
|`<hierarchy_generator_function>`|Specifies a hierarchy generator function directly (for example, the HIERARCHY function).|


### <hierarchy_navfunc_start_spec>

Specifies the start nodes as an additional input table or as a filter condition on the source. If

```
<hierarchy_navfunc_start_spec> ::= START { <table_valued_expression> | WHERE <condition> }
```

|`<table_valued_expression>`|Specifies a table-valued expression containing, at minimum, a column named or aliased as START_RANK that has a data type that can be cast to BIGINT.|
|`<condition>`|Specifies a starting condition that is semantically equivalent to|


<!-- section id="section_ist_gwn_cz" -->
## Description

The HIERARCHY_SIBLINGS function returns siblings of a set of start nodes including the respective start nodes.

Column-wise, HIERARCHY_SIBLINGS projects all attributes of the source hierarchy plus a lateral projection of the corresponding START record. Additionally, a HIERARCHY_SIBLING_DISTANCE column is generated, which contains the hierarchy rank difference between a start node and a result node. The data type of HIERARCHY_SIBLING_DISTANCE is BIGINT NOT NULL

The main purpose of HIERARCHY_SIBLING_DISTANCE is the determination of siblings with particular relative locations, such as the first sibling (minimum distance), the next preceding sibling (highest distance less than 0), the next following sibling (lowest distance greater than 0), and the last sibling (maximum distance).

<!-- section id="section_xdq_hwn_cz" -->
## Examples

### HIERARCHY_SIBLINGS operating on an unfiltered
					hierarchy

The following example determines the set of siblings of node C4. It is based on the data set introduced in section

```
SELECT DISTINCT
    node_id,
    hierarchy_sibling_distance
FROM HIERARCHY_SIBLINGS (
    SOURCE h_demo
    START WHERE node_id = 'C4' )
ORDER BY
    node_id;
```

|NODE_ID|HIERARCHY_SIBLING_DISTANCE|
|---|---|
|B3|-1|
|C3|-3|
|C4|0|


Further examples are given in section

### HIERARCHY_SIBLINGS operating on a complete subtree in a
					hierarchy

HIERARCHY_SIBLINGS can also operate on a SOURCE which is a complete subtree of a node in a given hierarchy.

```
DROP TABLE hierarchy_source CASCADE;
CREATE COLUMN TABLE hierarchy_source (parent_id VARCHAR(2), node_id VARCHAR(2));

INSERT INTO hierarchy_source VALUES ( null, 'A1' );
INSERT INTO hierarchy_source VALUES ( 'A1', 'B1' );
INSERT INTO hierarchy_source VALUES ( 'A1', 'B2' );
INSERT INTO hierarchy_source VALUES ( 'B1', 'C1' );
INSERT INTO hierarchy_source VALUES ( 'B1', 'C2' );
INSERT INTO hierarchy_source VALUES ( 'B2', 'C3' );
INSERT INTO hierarchy_source VALUES ( 'C3', 'D1' );
INSERT INTO hierarchy_source VALUES ( 'C3', 'D2' );
INSERT INTO hierarchy_source VALUES ( 'B2', 'C4' );
INSERT INTO hierarchy_source VALUES ( 'C4', 'D3' );
INSERT INTO hierarchy_source VALUES ( null, 'R1' );
INSERT INTO hierarchy_source VALUES ( 'R1', 'S1' );
INSERT INTO hierarchy_source VALUES ( 'R1', 'S2' );
INSERT INTO hierarchy_source VALUES ( 'S2', 'T1' );

drop view hierarchy_view cascade;
create view hierarchy_view as select * from hierarchy(
    source hierarchy_source
    SIBLING ORDER BY node_id);


drop view subtree_B2 cascade;
create view subtree_B2 as select
    hierarchy_rank,
    hierarchy_tree_size,
    hierarchy_parent_rank,
    hierarchy_level,
    hierarchy_is_cycle,
    hierarchy_is_orphan,
    parent_id,
    node_id
from hierarchy_descendants(
    source hierarchy_view
    start where node_id = 'B2');

select * from subtree_B2 order by hierarchy_rank;
```

|HIERARCHY_RANK|HIERARCHY_TREE_SIZE|HIERARCHY_PARENT_RANK|HIERARCHY_LEVEL|HIERARCHY_IS_CYCLE|HIERARCHY_IS_ORPHAN|PARENT_ID|NODE_ID|
|---|---|---|---|---|---|---|---|
|5|6|1|2|0|0|A1|B1|
|6|3|5|3|0|0|B2|C3|
|7|1|6|4|0|0|C3|D1|
|8|1|6|4|0|0|C3|D2|
|9|2|5|3|0|0|B2|C4|
|10|1|9|4|0|0|C4|D3|


Below an example for HIERARCHY_SIBLINGS operating on the subtree of node B2:

```
select * from hierarchy_siblings(
    source subtree_B2
    start where node_id = 'C4')
order by hierarchy_rank;
```

|HIERARCHY_RANK|HIERARCHY_TREE_SIZE|HIERARCHY_PARENT_RANK|HIERARCHY_LEVEL|HIERARCHY_IS_CYCLE|HIERARCHY_IS_ORPHAN|PARENT_ID|NODE_ID|HIERARCHY_SIBLING_DISTANCE|START_RANK|
|---|---|---|---|---|---|---|---|---|---|
|6|3|5|3|0|0|B2|C3|-3|9|
|9|2|5|3|0|0|B2|C4|0|9|


The subtree can also be a complete tree of a particular root node in the original hierarchy. Below an example for the complete tree of root node R1.

```
drop view subtree_R1 cascade;
create view subtree_R1 as select
    hierarchy_rank,
    hierarchy_tree_size,
    hierarchy_parent_rank,
    hierarchy_level,
    hierarchy_is_cycle,
    hierarchy_is_orphan,
    parent_id,
    node_id
from hierarchy_descendants(
    source hierarchy_view
    start where node_id = 'R1');

select * from subtree_R1 order by hierarchy_rank;
```

|HIERARCHY_RANK|HIERARCHY_TREE_SIZE|HIERARCHY_PARENT_RAN|HIERARCHY_LEVEL|HIERARCHY_IS_CYCLE|HIERARCHY_IS_ORPHAN|PARENT_ID|NODE_ID|
|---|---|---|---|---|---|---|---|
|11|4|0|1|0|0|NULL|R1|
|12|1|11|2|0|0|R1|S1|
|13|2|11|2|0|0|R1|S2|
|14|1|13|3|0|0|S2|T1|


Below an example for HIERARCHY_SIBLINGS operating on the subtree of node R1:

```
select * from hierarchy_siblings(
    source subtree_R1
    start where node_id = 'S2')
order by hierarchy_rank;
```

|HIERARCHY_RANK|HIERARCHY_TREE_SIZE|HIERARCHY_PARENT_RANK|HIERARCHY_LEVEL|HIERARCHY_IS_CYCLE|HIERARCHY_IS_ORPHAN|PARENT_ID|NODE_ID|HIERARCHY_SIBLING_DISTANCE|START_RANK|
|---|---|---|---|---|---|---|---|---|---|
|12|1|11|2|0|0|R1|S1|-1|13|
|13|2|11|2|0|0|R1|S2|0|13|

