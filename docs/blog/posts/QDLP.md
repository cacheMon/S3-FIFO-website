---
date: 2023-06-01
authors:
  - jason
categories:
  - Algorithm
  - Performance
---

# FIFO is Better than LRU: the Power of Lazy Promotion and Quick Demotion

**TL;DR** 

Historically FIFO-based algorithms are thought to be less efficient (having higher miss ratios) than LRU-based algorithms.
In this blog, we introduce two techniques, **lazy promotion**, which promotes objects only at eviction time, and **quick demotion**, which removes most new objects quickly. We will show that

* Conventional-wisdom-suggested "weak LRUs", e.g., FIFO-Reinsertion, is actually more efficient (having lower miss ratios) than LRU;
* Simply evicting most new objects can improve state-of-the-art algorithm's efficiency.
* Eviction algorithms can be designed like building LEGOs by adding **lazy promotion** and **quick demotion** on top of FIFO.

<!-- more -->


## Background
Caching is a well-known and widely deployed technique to speed up data access, reduce repeated computation and data transfer. 
A core component of a cache is the eviction algorithm, which chooses the objects stored in the limited cache space.
Two metrics describe the performance of an eviction algorithm: efficiency measured by the miss ratio and throughput measured by the number of requests served per second.

The study of cache eviction algorithms has a long history, with a majority of the work centered around LRU (that is, to evict the least-recently-used object).
LRU maintains a doubly-linked list, promoting objects to the head of the list upon cache hits and evicting the object at the tail of the list when needed.
Belady and others found that memory access patterns often exhibit temporal locality --- “the most recently used pages were most likely to be reused in the immediate future”. Thus, LRU using *recency* to promote objects was found to be better than FIFO.

Most eviction algorithms designed to achieve high efficiency start from LRU.
For example, many algorithms, such as ARC, SLRU, 2Q, MQ, and multi-generational LRU, use multiple LRU queues to separate hot and cold objects. Some algorithms, e.g., LIRS and LIRS2, maintain an LRU queue but use different metrics to promote objects. While other algorithms, e.g., LRFU, EE-LRU, LeCaR, and CACHEUS, augment LRU's recency with different metrics. In addition, many recent works, e.g., Talus, improve LRU's ability to handle scan and loop requests.

Besides efficiency, there have been fruitful studies on enhancing the cache's throughput performance and thread scalability. Each cache hit in LRU promotes an object to the head of the queue, which requires updating at least six pointers guarded by locks.
These overheads are not acceptable in many deployments that need high performance.
Thus, performance-centric systems often use FIFO-based algorithms to avoid LRU's overheads.
For example, FIFO-Reinsertion and variants of CLOCK have been developed, which serve as LRU approximations.
*It is often perceived that these algorithms trade miss ratio for better throughput and scalability.*

In this blog, I am going to show that FIFO is in-fact better than LRU not only because of higher throughput, more scalable, but also more efficient and effective (having lower miss ratios).


## Why FIFO and What it needs
FIFO has many benefits over LRU. 
For example, FIFO has *less metadata* and requires no metadata update on each cache hit, and thus is *faster and more scalable* than LRU. In contrast, LRU requires updating six pointers on each cache hit, which is not friendly for modern computer architecture due to random memory accesses. Moreover, FIFO is always the first choice when implementing a flash cache because it does not incur write amplification. Although FIFO has throughput and scalability benefits, it is common wisdom that FIFO is less effective (having higher miss ratio) than LRU.





<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/cacheAbs.svg" alt="cache abstraction" style="width:64%">
  <figcaption><h4>A cache can be viewed as a logically ordered queue with four operations: insertion, removal, promotion and demotion. Most eviction algorithms are promotion algorithms. </h4></figcaption>
</figure> 
</center>


To understand the various factors that affect the miss ratio, we introduce a cache abstraction. 
A cache can be viewed as a logically total-ordered queue with four operations: <span style="font-family:monaco;">insertion</span>, <span style="font-family:monaco;">removal</span>, <span style="font-family:monaco;">promotion</span>, and <span style="font-family:monaco;">demotion</span>.
Objects in the cache can be compared and ordered based on some metric (e.g., time since the last request), and the eviction algorithm evicts the least valuable object based on the metric.
<span style="font-family:monaco;">Insertion</span> and <span style="font-family:monaco;">removal</span> are user-controlled operations, where <span style="font-family:monaco;">removal</span> can either be directly invoked by the user or indirectly via the use of time-to-live (TTL).
<span style="font-family:monaco;">Promotion</span> and <span style="font-family:monaco;">demotion</span> are internal operations of the cache used to maintain the logical ordering between objects.


We observe that most eviction algorithms use <span style="font-family:monaco;">promotion</span> to update the ordering between objects.
For example, all the LRU-based algorithms promote objects to the head of the queue on cache hits, which we call <span style="font-family:monaco;">eager promotion</span>.
Meanwhile, <span style="font-family:monaco;">demotion</span> is performed implicitly: when an object is promoted, other objects are passively demoted.
We call this process <span style="font-family:monaco;">passive demotion</span>, a slow process as objects need to traverse through the cache queue before being evicted.
However, we will show that instead of eager promotion and passive demotion, eviction algorithms should use **lazy promotion** and **quick demotion**.



## Lazy Promotion
To avoid popular objects from being evicted while not incurring much performance overhead, we propose adding **lazy promotion** on top of FIFO (called <span style="font-family:arial; font-variant-cap:petite-caps"> LP-FIFO</span>), which *promotes objects only when they are about to be evicted*.
**lazy promotion** aims to retain popular objects with minimal effort.
An example is FIFO-Reinsertion (note that FIFO-Reinsertion, 1-bit CLOCK, and Second Chance are different implementations of the same eviction algorithm): an object is reinserted at eviction time if it has been requested while in the cache. 

<span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> has several benefits over eager promotion (promoting on every access) used in LRU-based algorithms.
First, <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> inherits FIFO's throughput and scalability benefits because few metadata operations are needed when an object is requested. For example, FIFO-Reinsertion only needs to update a Boolean field upon the *first* request to a cached object without locking.
Second, performing promotion at eviction time allows the cache to make better decisions by accumulating more information about the objects, e.g., how many times an object has been requested.

<style>
    table {
        margin-left: auto;
        margin-right: auto;
    }
</style>


| Trace          | approx time | #trace | cache type | #req (millions) | #obj (millions) |
|----------------|-------------|-------:|-----------:|----------------:|----------------:|
| MSR            | 2007        |     13 |      block |       410       |              74 |
| FIU            | 2008        |      9 |      block |       514       |              20 |
| Cloudphysics   | 2015        |    106 |      block |      2,114      |             492 |
| Major CDN      | 2018        |    219 |     object |      3,728      |             298 |
| Tencent Photo  | 2018        |      2 |     object |      5,650      |           1,038 |
| Wiki CDN       | 2019        |      3 |     object |      2,863      |              56 |
| Tencent CBS    | 2020        |   4030 |      block |      33,690     |             551 |
| Alibaba        | 2020        |    652 |      block |      19,676     |            1702 |
| Twitter        | 2020        |     54 |         KV |     195,441     |          10,650 |
| Social Network | 2020        |    219 |         KV |     549,784     |          42,898 |


To understand <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span>'s efficiency,
we performed a large-scale simulation study on 5307 production traces from 10 data sources, which include open-source and proprietary datasets collected between 2007 and 2020.
The 10 datasets contain 814 billion (6,386 TB) requests and 55.2 billion (533 TB) objects, and cover different types of caches, including block, key-value (KV), and object caches.
We further divide the traces into block and web (including Memcached and CDN).
We choose small/large cache size as 0.1%/10% of the number of unique objects in the trace.

We compare the miss ratios of LRU with two <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> algorithms:
FIFO-Reinsertion and 2-bit CLOCK.
2-bit CLOCK tracks object frequency up to three, and an object's frequency decreases by one each time the CLOCK hand scans through it. Objects with frequency zero are evicted.

Common wisdom suggests that these two <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> examples are LRU approximations and will exhibit higher miss ratios than LRU.
However, we found that **<span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> often exhibits miss ratios lower than LRU**.

<center>
<figure style="width: 100%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/multi_LRU_FIFO_Reinsertion_1.svg" alt="linear scale" style="width:24%"> &nbsp;
  <img src="/assets/posts/2023-06-24-fifo-lru/multi_LRU_Clock-2_1.svg" alt="log scale" style="width:23%"> &nbsp;
  <img src="/assets/posts/2023-06-24-fifo-lru/multi_LRU_FIFO_Reinsertion_3.svg" alt="linear scale" style="width:24%"> &nbsp;
  <img src="/assets/posts/2023-06-24-fifo-lru/multi_LRU_Clock-2_3.svg" alt="log scale" style="width:23%"> &nbsp;
  <figcaption><h4>Comparison of FIFO-Reinsertion, 2-bit CLOCK and LRU on 10 datasets with 5307 traces. Left two: small cache, right two: large cache. A longer bar means the algorithm is more efficient (having lower miss ratios on more traces). Note that we do not consider the overhead of LRU metadata in all the evaluations. </h4></figcaption>
</figure> 
</center>


The figure above shows that FIFO-Reinsertion and 2-bit CLOCK are better than LRU on most traces.
Specifically, FIFO-Reinsertion is better than LRU on 9 and 7 of the 10 datasets using a small and large cache size, respectively.
Moreover, on half of the datasets, more than 80% of the traces in each dataset favor FIFO-Reinsertion over LRU at both sizes.
On the two social network datasets, LRU is better than FIFO-Reinsertion (especially at the large cache size). This is because most objects in these two datasets are accessed more than once, and using one bit to track object access is insufficient. Therefore, when increasing the one bit in FIFO-Reinsertion (CLOCK) to two bits (2-bit CLOCK), we observe that the number of traces favoring <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> increases to around 70%.
Across all datasets, 2-bit CLOCK is better than FIFO on all datasets at the small cache size and 9 of the 10 datasets at the large cache size.


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/LP.svg" alt="LP leads to QD" style="width:50%">
  <figcaption><h4>FIFO-Reinsertion demotes new objects faster than LRU because objects requested before the new object also pushes it down the queue. </h4></figcaption>
</figure> 
</center>


Two reasons contribute to <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span>'s high efficiency.
First, **lazy promotion** often leads to **quick demotion**. For example, under LRU, a newly-inserted object *G* is pushed down the queue only by (1) new objects and (2) cached objects that are requested after *G*. However, besides the objects requested after *G*, the objects requested before *G* (but have not been promoted, e.g., *B*, *D*) also push *G* down the queue when using FIFO-Reinsertion.
Second, compared to promotion at each request, object ordering in <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> is closer to the insertion order, which we conjecture is better suited for many workloads that exhibit popularity decay --- old objects have a lower probability of getting a request.


While <span style="font-family:arial; font-variant-cap:small-caps">LP-FIFO</span> surprisingly wins over LRU in miss ratio, it cannot outperform state-of-the-art algorithms. We next discuss another building block that bridges this gap.







## Quick Demotion
Efficient eviction algorithms not only need to keep popular objects in the cache but also need to evict unpopular objects fast. In this section, we show that **quick demotion** (QD) is critical for an efficient eviction algorithm, and it enables FIFO-based algorithms to achieve state-of-the-art efficiency.

Because demotion happens passively in most eviction algorithms, an object typically traverses through the cache before being evicted. Such traversal gives each object a good chance to prove its value to be kept in the cache.
However, cache workloads often follow Zipf popularity distribution, with most objects being unpopular.
This is further exacerbated by (1) the scan and loop access patterns in the block cache workloads, and (2) the vast existence of dynamic and short-lived data, the use of versioning in object names, and the use of short TTLs in the web cache workloads.
We believe the *opportunity cost of new objects demonstrating their values is often too high*: the object being evicted at the tail of the queue may be more valuable than the objects recently inserted.


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/QD.svg" alt="QD example" style="width:64%">
  <figcaption><h4>An example of quick demotion: adding a small FIFO to filter most new objects that do not have a request soon after insertion. </h4></figcaption>
</figure> 
</center>


To illustrate the importance of **quick demotion**, we add a simple QD technique on top of state-of-the-art eviction algorithms.
The QD technique consists of a small probationary FIFO queue storing cached data and a ghost FIFO queue storing metadata of objects evicted from the probationary FIFO queue.
The probationary FIFO queue uses 10% of the cache space and acts as a filter for unpopular objects: objects not requested after insertion are evicted early from the FIFO queue. The main cache runs a state-of-the-art algorithm and uses 90% of the space.
And the ghost FIFO stores as many entries as the main cache.
Upon a cache miss, the object is written into the probationary FIFO queue unless it is in the ghost FIFO queue, in which case, it is written into the main cache.
When the probationary FIFO queue is full, if the object to evict has been accessed since insertion, it is inserted into the main cache. Otherwise, it is evicted and recorded in the ghost FIFO queue.


We add this FIFO-based QD technique to five state-of-the-art eviction algorithms, ARC, LIRS, CACHEUS, LeCaR, and LHD.
We used the open-source LHD implementation from the authors, implemented the others following the corresponding papers, and cross-checked with open-source implementations.
We evaluated the QD-enhanced and original algorithms on the 5307 traces.
Because the traces have a wide range of miss ratios, we choose to present each algorithm's miss ratio reduction from FIFO calculated as *(mr<sub>FIFO</sub> - mr<sub>algo</sub>) / mr<sub>FIFO</sub>*.


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/block_1.svg" alt="small size" style="width:48%">
  <img src="/assets/posts/2023-06-24-fifo-lru/block_3.svg" alt="large size" style="width:48%">
  <figcaption><h4>On the block traces, quick demotion can improve most state-of-the-art algorithm's efficiency. Left: small cache, right: large cache. </h4></figcaption>
</figure> 
</center>

<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-06-24-fifo-lru/web_1.svg" alt="small size" style="width:48%">
  <img src="/assets/posts/2023-06-24-fifo-lru/web_3.svg" alt="large size" style="width:48%">
  <figcaption><h4>On the web traces, quick demotion can improve all state-of-the-art algorithm's efficiency. Left: small cache, right: large cache. </h4></figcaption>
</figure> 
</center>


The figures above show that the QD-enhanced algorithms further reduce the miss ratio of each state-of-the-art algorithm on almost all percentiles. For example, QD-ARC (QD-enhanced ARC) reduces ARC's miss ratio by up to 59.8% with a mean reduction of 1.5% across all workloads on the two cache sizes, QD-LIRS reduces LIRS's miss ratio by up to 49.6% with a mean of 2.2%, and QD-LeCaR reduces LeCaR's miss ratio by up to 58.8% with a mean of 4.5%.
Note that achieving a large miss ratio reduction on a large number of diverse traces is non-trivial. For example, the best state-of-the-art algorithm, ARC, can only reduce the miss ratio of LRU 6.2% on average.

The gap between the QD-enhanced algorithm and the original algorithm is wider (1) when the state-of-the-art is relatively weak, (2) when the cache size is large, and (3) on the web workloads.
With a weaker state-of-the-art, the opportunity for improvement is larger, allowing QD to provide more prominent benefits. For example, QD-LeCaR reduces LeCaR's miss ratios by 4.5% on average, larger than the reductions on other state-of-the-art algorithms.
When the cache size is large, unpopular objects spend more time in the cache, and **quick demotion** becomes more valuable.
For example, QD-ARC and ARC have similar miss ratios on the block workloads at the small cache size. But QD-ARC reduces ARC's miss ratio by 2.3% on average at the large cache size.
However, when the cache size is too large, e.g., 80% of the number of objects in the trace,
adding QD may increase the miss ratio (not shown).
At last, QD provides more benefits on the web workloads than the block workloads, especially when the cache size is small. We conjecture that web workloads have more short-lived data and exhibit stronger popularity decay, which leads to a more urgent need for **quick demotion**.
While **quick demotion** improves the efficiency of most state-of-the-art algorithms, for a small subset of traces, QD may increase the miss ratio when the cache size is small because the probationary FIFO is too small to capture some potentially popular objects.


Although adding the probationary FIFO improves efficiency, it further increases the complexity of the already complicated state-of-the-art algorithms.
To reduce complexity, we add the same QD technique on top of 2-bit CLOCK and call it <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span>.
<span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> uses two FIFO queues to cache data and a ghost FIFO queue to track evicted objects.
It is not hard to see <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> is simpler than all state-of-the-art algorithms --- it requires at most one metadata update on a cache hit and no locking for any cache operation. Therefore, we believe it will be faster and more scalable than all state-of-the-art algorithms.
Besides enjoying all the benefits of simplicity, <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> also achieves lower miss ratios than state-of-the-art algorithms.
For example, compared to LIRS and LeCaR, <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> reduces miss ratio by 1.6% and 4.3% on average, respectively, across the 5307 traces.
While the goal of this work is not to propose a new eviction algorithm, <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> illustrates how we can build simple yet efficient eviction algorithms by adding **quick demotion** and **lazy promotion** techniques to a simple base eviction algorithm such as FIFO.



## Discussion
We have demonstrated reinsertion as an example of LP and the use of a small probationary FIFO queue as an example of QD. However, these are not the only techniques.
For example, reinsertion can leverage different metrics to decide whether the object should be reinserted. Besides reinsertion, several other techniques are often used to reduce promotion and improve scalability, e.g., periodic promotion, batched promotion, promoting old objects only, and promoting with try-lock. 
Although these techniques do not fall into our strict definition of **lazy promotion** (promotion on eviction), many of them effectively retain popular objects from being evicted.
On the **quick demotion** side, besides the small probationary FIFO queue, one can leverage other techniques to define and discover unpopular objects such as Hyperbolic and LHD.
Moreover, admission algorithms, e.g., TinyLFU, Bloom Filter, probabilistic, and ML-based admission algorithms, can be viewed as a form of QD --- albeit some of them are too aggressive at demotion (rejecting objects from entering the cache).

Note that QD bears similarity with some generational garbage collection algorithms, which separately store short-lived and long-lived data in young-gen and old-gen heaps.
Therefore, ideas from garbage collection may be borrowed to strengthen cache eviction algorithms.

The design of <span style="font-family:arial; font-variant-cap:small-caps">QD-LP-FIFO</span> opens the door to designing simple yet efficient cache eviction algorithms by innovating on LP and QD techniques. And we envision future eviction algorithms can be designed like building LEGO --- adding **lazy promotion** and **quick demotion** on top of a base eviction algorithm.





## Acknowledgement
There are many people I would like to thank, including but not limited to my co-authors, Carnegie Mellon University Parallel Data Lab (and our sponsors), and Cloudlab. 
I would also like to give a big shoutout to the people and organizations that open-sourced the traces, without which, this work is not possible and we will NEVER know that **CLOCK is better than LRU on every aspect**! 


This work is published at HotOS'23, more details can be found [here](https://dl.acm.org/doi/10.1145/3593856.3595887), and the slides can be found [here](https://jasony.me/slides/hotos23-qdlp.pdf). 




