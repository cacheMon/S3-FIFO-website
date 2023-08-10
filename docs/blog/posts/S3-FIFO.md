---
date: 2023-08-06
authors:
  - jason
categories:
  - Algorithm
  - Performance
---

# FIFO queues are all you need for cache eviction
**TL;DR** 

In this blog, I will describe a simple, scalable FIFO-based eviction algorithm with three static queues (S3-FIFO). Evaluated on 6594 cache traces from 14 datasets, we show that S3-FIFO has lower miss ratios than 12 state-of-the-art algorithms. Moreover, S3-FIFO’s efficiency is robust — it has the lowest mean miss ratio on 10 of the 14 datasets. The use of FIFO queues enables S3-FIFO to achieve good scalability with 6× higher throughput compared to optimized LRU at 16 threads. 
<!-- more -->

Our insight is that most objects in skewed cache workloads will only be accessed once in a short window, so it is critical to evict them early. And the key of S3-FIFO is a small FIFO queue that filters out most objects from entering the main cache. We show that filtering with a small static FIFO queue has a guaranteed eviction time and higher eviction precision compared to state-of-the-art adaptive algorithms.


## Background
Software caches, such as Memcached, database buffer pool, and page cache, are widely deployed today to speed up data access. 
A cache should be 
1. *efficient / effective*: it should provide a low miss ratio allowing most requests to be fulfilled by the fast cache; 
2. *performant*: serving data from the cache should perform minimal operations; and 
3. *scalable*: the number of cache hits it can serve per second grows with the number of CPU cores. 
The soul of a cache is the *eviction algorithm*, which dictates a cache's efficiency, throughput, and scalability. 

### LRU and FIFO based eviction
While FIFO and LRU are the classics of cache eviction algorithm, many eviction algorithms have been desined in the past few decades to pursue better efficiency, e.g., [ARC](https://www.usenix.org/conference/fast-03/arc-self-tuning-low-overhead-replacement-cache), 
[2Q](https://www.vldb.org/conf/1994/P439.PDF), 
[LIRS](https://ranger.uta.edu/~sjiang/pubs/papers/jiang02_LIRS.pdf), 
[TinyLFU](https://arxiv.org/abs/1512.00727).
Because conventional wisdom suggests that LRU provides lower miss ratio than FIFO ([although we recently found it to be false](https://blog.jasony.me/system/cache/2023/06/01/fifo-lru.html)), these advanced algorithms are often LRU-based, using different techniques and metrics on top of one or more LRU queues. 
However, LRU-based algorithms suffer from two problems: (1) it requires two pointers per object, a large storage overhead for workloads consisting of small objects; and (2) it is not scalable because each cache hit requires promoting the requested object to the head of the queue guarded by *locking*. 

### The importance of simplicity and scalability
Modern CPUs have a large number of cores. For example, AMD EPYC 9654P has 192 cores/threads. 
A cache's scalability measures how its throughput increases with the number of CPU cores. 
Ideally, a cache's throughput would scale linearly with the number of CPU cores. However, read operations necessitate metadata updates under locking in LRU-based algorithms. Therefore, they cannot fully harness the computation power of modern CPUs.

> "Predicting which pages will be accessed in the near future is a tricky task, and the kernel has evolved a number of mechanisms designed to improve its chances of guessing right. But the kernel not only often gets it wrong, it also can expend a lot of CPU time to make the incorrect choice".   ---- [Kernel developers](https://lwn.net/Articles/851184/)

A cache eviction algorithm's complexity also plays a critical role in its adoption. 
While the complexity is often correlated with throughput, a simple design can also bring fewer bugs and reduced maintenance overhead. 

### FIFO is the future
While the eviction algorithm so far have been centered around LRU, we believe modern eviction algorithms should be designed with FIFO queues. 
FIFO can be implemented using a ring buffer without per-object pointer metadata, and it does not promote an object upon each cache hit, thus removing the scalability bottleneck. Moreover, FIFO evicts objects in the same order as the insertion, which is a flash-friendly access pattern and minimizes flash writes and wearout. 
However, FIFO falls behind LRU and state-of-the-art eviction algorithms in efficiency. 

## Observation: more one-hit wonders than you would have expected 
The term ``one-hit-wonder ratio'' measures the fraction of objects that are requested only once in a sequence. It is commonly used in content delivery networks (CDNs) due to large one-hit-wonder ratios.
Although one-hit-wonder ratio varies between different types of cache workloads, we find that **shorter request sequences with fewer objects often have higher one-hit-wonder ratios**. 

### A toy example
<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/diagram_oneHit.svg" alt="one-hit-wonder ratio toy example" style="width:64%">
  <figcaption><h4>An illustration of one-hit-wonder ratio (fraction of objects accessed once) increases with shorter request sequence. </h4></figcaption>
</figure> 
</center>


The figure above illustrates this observation using a toy example. 
The request sequence comprises seventeen requests for five objects, out of which one object (E) is accessed once. Thus, the one-hit-wonder ratio for the sequence is 20%.

{% katexmm %}
Considering a shorter sequence from the $1^{st}$ to the $7^{th}$ request, two (C, D) of the four unique objects are requested only once, which leads to a one-hit-wonder of 50%. 
Similarly, the one-hit-wonder ratio of a shorter sequence from the $1^{st}$ to $4^{th}$ request is 67%. 
{% endkatexmm %}


### Examples from production traces
Does this hold on production cache workloads? 


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/one_hit_ratio_trace.svg" alt="linear scale" style="width:40%">
  <img src="/assets/posts/2023-08-16-s3fifo/one_hit_ratio_trace_log.svg" alt="log scale" style="width:40%">
  <figcaption><h4>An illustration of one-hit-wonder ratio on production traces. The full trace has 20% to 60% objects accessed once, however, shorter sequences have much higher one-hit-wonder ratio. </h4></figcaption>
</figure> 
</center>

The figure above show a block cache trace (MSR hm_0) and a key-value trace from Twitter (cluster 52). The X-axis shows the fraction of objects in the trace (in linear and log scales). 
Compared to the one-hit-wonder ratio of the full trace at 13% (Twitter) and 38% (MSR), a random sub-sequence containing 10% objects has a one-hit-wonder ratio of 26% on the Twitter trace and 75% on the MSR trace. The increase is more significant when the sequence length is further reduced. 

<center>
<figure style="width: 80%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/one_hit.svg" alt="boxplot" style="width:80%">
  <figcaption><h4>A box plot showing one-hit-wonder ratio distribution on 6594 production traces. </h4></figcaption>
</figure> 
</center>

We further analyzed a large cache trace collection of 6594 traces (more details can be found in the result section), and we plot the one-hit-wonder ratio distribution in box plots. 
Compared to the full traces with a median one-hit-wonder ratio of 26%, sequences containing 50% of the objects in the trace show a median one-hit-wonder ratio of 38%. Moreover, sequences with 10% and 1% of the objects exhibit one-hit-wonder ratios of 72% and 78%, respectively.  

### Implication of a large one-hit-wonder ratio
The traces we used in the analysis are mostly week-long with a few month-long. 
Because the cache size is often much smaller than the trace footprint (the number of objects in the trace), **evictions start after encountering a short sequence of requests**. Our observation suggests that if the cache size is at 10% of the trace footprint, approximately 72% of the objects would not be reused before eviction. 


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/eviction_freq_twitter_lru.svg" alt="Twitter LRU" style="width:40%">
  <img src="/assets/posts/2023-08-16-s3fifo/eviction_freq_msr_lru.svg" alt="MSR LRU" style="width:40%">
  <figcaption><h4>A huge portion of objects in the cache are not accessed before eviction when using LRU, similar observations can be found when using other algorithms. </h4></figcaption>
</figure> 
</center>

We further corroborate the observation with cache simulations. The figure above shows the distribution of object frequency at eviction. 
Our trace analysis shows that the Twitter trace has a 26% one-hit-wonder ratio for sequences of 10% trace length. 
The simulation shows a similar result: 26% of the objects evicted by LRU have are not requested after insertion at the cache size of 10% of the trace footprint. 
Similarly, the MSR trace exhibits a higher one-hit-wonder ratio of 75% for sequences of 10% trace length, and the simulations shows that 82% of the objects evicted by LRU have no reuse. 

*It is evident that the cache should filter out these one-hit wonders because they occupy space without providing benefits.*


## S3-FIFO: an eviction algorithm with only FIFO queues

Motivated by the observation in the previous section, 
we have designed a new cache eviction algorithm called S3-FIFO: **S**imple, **S**calable caching with **three** **S**tatic FIFO queues. 


<center>
<figure style="width: 80%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/diagram_s3fifo.svg" alt="S3FIFO diagram" style="width:80%">
  <figcaption><h4>An illustration of S3-FIFO. </h4></figcaption>
</figure> 
</center>


S3-FIFO uses three FIFO queues: a small FIFO queue (<span style="font-family:Fantasy; font-variant-cap:small-caps">S</span>), a main FIFO queue (<span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>), and a ghost FIFO queue (<span style="font-family:Fantasy; font-variant-cap:small-caps">G</span>). 
We choose <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> to use 10% of the cache space based on experiments with 10 traces and find that 10% generalizes well. 
<span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> then uses 90% of the cache space. The ghost queue <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span> stores the same number of ghost entries (no data) as <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>. 

**Cache read**: 
S3-FIFO uses two bits per object to track object access status similar to a capped counter with frequency up to 3[^1]. 
Cache hits in S3-FIFO increment the counter by one atomically. Note that most requests for popular objects require no update. 

**Cache write**:
New objects are inserted into <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> if not in <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span>. Otherwise, it is inserted into <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>. 
When <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> is full, the object at the tail is either moved to <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> if it is accessed more than once or <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span> if not. 
And its access bits are cleared during the move.  
When <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span> is full, it evicts objects in FIFO order. 
<span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> uses an algorithm similar to FIFO-Reinsertion but tracks access information using two bits. 
Objects that have been accessed at least once are reinserted with one bit set to 0 (similar to decreasing frequency by 1). 


### Implementation
Although S3-FIFO has three FIFO queues, it can also be implemented with one or two FIFO queue(s). 
Because objects evicted from <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> may enter <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>, they can be implemented using one queue with a pointer pointed at the 10% mark. 
However, combining <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> and <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> reduces scalability because removing objects from the middle of the queue requires locking. 

The ghost FIFO queue <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span> can be implemented as part of the indexing structure. 
For example, we can store the fingerprint and eviction time of ghost entries in a bucket-based hash table. 
The fingerprint stores a hash of the object using 4 bytes, and the eviction time is a timestamp measured in the number of objects inserted into <span style="font-family:Fantasy; font-variant-cap:small-caps">G</span>. 
We can find out whether an object is still in the queue by calculating the difference between current time and insertion time since it is a FIFO queue. 
The ghost entries stay in the hash table until they are no longer in the ghost queue. When an entry is evicted from the ghost queue, it is not immediately removed from the hash table. Instead, the hash table entry is removed during hash collision --- when the slot is needed to store other entries.  

## How does S3-FIFO compare to other algorithms
### Dataset we used in this blog
We evaluated S3-FIFO using a large collection of 6594 production traces from 14 datasets, including 11 open-source and 3 proprietary datasets. These traces span from 2007 to 2023 and cover key-value, block, and object CDN caches. In total, the datasets contain 856 billion requests to 61 billion objects, 21,088 TB traffic for total 3,573 TB of data. 
More details of the datasets can be found in the table. 



<style>
    table {
        margin-left: auto;
        margin-right: auto;
    }
</style>



| Dataset collections | Approx time | Cache type | time span  (days) |  Traces |  Request  (million) | Request  (TB) |  Object  (million) | Object  (TB) | One-hit-wonder ratio (full trace) | One-hit-wonder ratio (10%) | One-hit-wonder ratio (1%) |
|:-------------------:|:-----------:|:----------:|:-----------------:|:--------:|:--------------------:|:-------------:|:-------------------:|:------------:|:---------------------------------:|:--------------------------:|:-------------------------:|
| MSR                 | 2007        |      Block |                30 |       13 |                  410 |            10 |                  74 |            3 |                              0.56 |            0.74            |            0.86           |
| FIU                 | 2008-11     |      Block |              9-28 |        9 |                  514 |           1.7 |                  20 |        0.057 |                              0.28 |            0.91            |            0.91           |
| Cloudphysics        | 2015        |      Block |                 7 |      106 |                2,114 |            82 |                 492 |           22 |                              0.40 |            0.71            |            0.80           |
| CDN 1               | 2018        |     Object |                 7 |      219 |                3,728 |          3640 |                 298 |          258 |                              0.42 |            0.58            |            0.70           |
| Tencent Photo       | 2018        |     Object |                 8 |        2 |                5,650 |           141 |               1,038 |           24 |                              0.55 |            0.66            |            0.74           |
| WikiMedia CDN       | 2019        |     Object |                 7 |        3 |                2,863 |           200 |                  56 |           13 |                              0.46 |            0.60            |            0.80           |
| Systor              | 2017        |      Block |                26 |        6 |                3,694 |            88 |                 421 |           15 |                              0.37 |            0.80            |            0.94           |
| Tencent CBS         | 2020        |      Block |                 8 |     4030 |               33,690 |          1091 |                 551 |           66 |                              0.25 |            0.73            |            0.77           |
| Alibaba             | 2020        |      Block |                30 |      652 |               19,676 |           664 |                1702 |          117 |                              0.36 |            0.68            |            0.81           |
| Twitter             | 2020        |         KV |                 7 |       54 |              195,441 |           106 |              10,650 |            6 |                              0.19 |            0.32            |            0.42           |
| Social Network 1    | 2020        |         KV |                 7 |      219 |              549,784 |           392 |              42,898 |            9 |                              0.17 |            0.28            |            0.37           |
| CDN 2               | 2021        |     Object |                 7 |     1273 |               37,460 |         4,925 |               2,652 |        1,581 |                              0.49 |            0.58            |            0.64           |
| Meta KV             | 2022        |         KV |                 1 |        5 |                1,644 |           958 |                  82 |           76 |                              0.51 |            0.53            |            0.61           |
| Meta CDN            | 2023        |     Object |                 7 |        3 |                  231 |         8,800 |                  76 |        1,563 |                              0.61 |            0.76            |            0.81           |


### Experiemnt setup
We implemented S3-FIFO and state-of-the-art algorithms in [libCacheSim](https://github.com/1a1a11a/libCacheSim), and used an [in house distributed computation platform](https://blog.jasony.me/tool/distComp) for running the large-scale evaluation.
Unless otherwise mentioned, we ignore object size because most production systems use slab storage for memory management, for which evictions are performed within the same slab class (objects of similar sizes). 
Because the large number of traces have a very wide range of miss ratios, we choose to present the miss ratio reduction compared to FIFO. 
We have also implemented a prototype in Cachelib, the details can be found in our paper. 
The simulation processed the datasets in close to 100 passes using different algorithms, cache sizes, and parameters. 
We estimated that over 80,000 billion requests were processed using a million CPU core • hours.


### Efficiency results
The primary criticism of the FIFO-based eviction algorithms is their efficiency, the most important metric for a cache. 
We compare S3-FIFO with 12 state-of-the-art eviction algorithms designed in the past few decades. We use a cache size of 10% of the trace footprint (number of objects in the trace). Other cache sizes show similar results. 

<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/miss_ratio_percentiles_2.svg" alt="miss ratio percentile result" style="width:80%">
  <figcaption><h4>Miss ratio reduction distribution of different algorithms, the cache size is 10% of objects in the trace (more figures in the paper). </h4></figcaption>
</figure> 
</center>


The figure above shows the (request) miss ratio reduction (compared to FIFO) of different algorithms across traces. 
S3-FIFO has the largest reductions across almost all percentiles than other algorithms. For example, S3-FIFO reduces miss ratios by more than 32% on 10% of the traces (P90) with a mean of 14%. 

**TinyLFU** is the closest competitor. TinyLFU uses a 1% LRU window to filter out unpopular objects and stores most objects in a SLRU cache. TinyLFU's good performance corroborates our observation that quick demotion is critical for efficiency. 
However, TinyLFU does not work well for all traces, with miss ratios being lower than FIFO on almost 20% of the traces (the P10 point is below -0.05 and not shown in the figure). 
This phenomenon is more pronounced when the cache size is small, where TinyLFU is worse than FIFO on close to 50% of the traces (not shown). 

There are two reasons why TinyLFU falls short. First, the 1% window LRU is too small, evicting objects too fast. 
Therefore, increasing the window size to 10% of the cache size (TinyLFU-0.1) significantly improves the efficiency at the tail (bottom of the figure). However, increasing the window size reduces its improvement on the best-performing traces. 
Second, when the cache is full, TinyLFU compares the least recently used entry from the window LRU and main SLRU, then evicts the less frequently used one. This allows TinyLFU to be more adaptive to different workloads. However, if the tail object in the SLRU happens to have a very high frequency, it may lead to the eviction of an excessive number of new and potentially useful objects. 


**LIRS** uses LRU stack (reuse) distance as the metric to choose eviction candidates. Because one-hit wonders do not have reuse distance, LIRS utilizes a 1% queue to hold them. This small queue performs quick demotion and is the secret source of LIRS's high efficiency. Similar to TinyLFU, the queue is too small, and it falls short on some cache workloads. 
However, compared to TinyLFU, fewer traces show higher-than-FIFO miss ratios because the inter-recency metric in LIRS is more robust than the frequency in TinyLFU. In particular, TinyLFU cannot distinguish between many objects with the same low frequency (e.g., 2), but these objects will have different inter-recency values. The downside is that LIRS requires a more complex implementation than TinyLFU. 


**2Q** has the most similar design to S3-FIFO. It uses 25% cache space for a FIFO queue, the rest for an LRU queue, and also has a ghost queue. Besides the difference in queue size and type, objects evicted from the small queue are \emph{not} inserted into the LRU queue. 
Having a large probationary queue and not moving accessed objects into the LRU queue are the primary reasons why 2Q is not as good as S3-FIFO. 
Moreover, we observe that the LRU queue does not provide observable benefits compared to the FIFO queue (with reinsertion) in S3-FIFO. 

**SLRU** uses four equal-sized LRU queues. Objects are first inserted into the lowest-level LRU queue and promoted to higher-level queues upon cache hits. An inserted object is evicted if not reused in the lowest LRU queue, which performs quick demotion and allows SLRU to show good efficiency. However, unlike other schemes, SLRU does not use a ghost queue, making it not scan-tolerant because popular objects mixed in the scan cannot be distinguished. Therefore, we observe that SLRU performs poorly on many block cache workloads (not shown). 

**ARC** uses four LRU queues: two for data and two for ghost entries. The two data queues are used to separate recent and frequent objects. Cache hits on objects in the recency queue promote the objects to the frequency queue. Objects evicted from the two data queues enter the corresponding ghost queue. The sizes of queues are adaptively adjusted based on hits on the ghost queues. When the recency queue is small, newly inserted objects are quickly evicted, enabling ARC's high efficiency. However, ARC is less efficient than S3-FIFO because the adaptive algorithm is not sufficient. We discuss more in \S\ref{sec:discussion:adaptive}. 


**Recent algorithms**, including [CACHEUS](https://www.usenix.org/conference/fast21/presentation/rodriguez), [LeCaR](https://www.usenix.org/conference/hotstorage18/presentation/vietri), [LHD](https://www.usenix.org/conference/nsdi18/presentation/beckmann), and [FIFO-Merge](https://segcache.com) are also evaluated. However, we find these algorithms are often less competitive than the traditional ones. In particular, FIFO-merge was designed for log-structured storage and key-value cache workloads without scan resistance. Therefore, similar to SLRU, it performs better on web cache workloads but much worse on block cache workloads. 

**Common algorithms**, such as B-LRU (Bloom Filter LRU), CLOCK, and LRU. CLOCK and LRU do not allow quick demotion, so their miss ratio reductions are small. 
B-LRU is the other extreme. It rejects all one-hit wonders at the cost of the second request for all objects being cache misses. Because of these misses, B-LRU is worse than LRU in most cases. 


**Adversarial workloads for S3-FIFO**:  We studied the limited number of traces on which S3-FIFO performed poorly and identified one pattern. 
Most objects in these traces are accessed only twice, and the second request falls out of the small FIFO queue <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span>, which causes the second request to these objects to be cache misses. These workloads are adversarial for most algorithms that partition the cache space, e.g., TinyLFU, LIRS, 2Q, and CACHEUS. 
Because the partition for newly inserted objects is smaller than the cache size, it is possible that the second request is a cache hit in LRU and FIFO, but not in these advanced algorithms. 


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/miss_ratio_per_dataset_2.svg" alt="miss ratio percentil result" style="width:80%">
  <figcaption><h4>Mean miss ratio reduction of different state-of-the-art algorithms (more results in the paper). S3-FIFO is the best on 10 of the 14 datasets. </h4></figcaption>
</figure> 
</center>


Not only being efficient, the efficient of S3-FIFO is also robust. 
The figure above shows the mean miss ratio reduction on each dataset using selected algorithms. S3-FIFO often outperforms all other algorithms by a large margin. Moreover, it is the best algorithm on 10 out of the 14 datasets, and among the top three most efficient algorithms on 13 datasets. 
As a comparison, TinyLFU and LIRS are among the top algorithms on some datasets, but on other datasets, they are among the worst algorithms. 

While (request) miss ratio is important for most, if not all, cache deployments, CDNs also widely use byte miss ratio to measure bandwidth reduction.  
Compared to other algorithms, S3-FIFO presents larger byte miss ratio reductions similar to the figure shown. 


### Throughput results
It is easy to see that as a FIFO-base algorithm, S3-FIFO is more scalable than LRU-based algorithms. 
Our implementation in Cachelib achieves 6x higher throughput than the optimized LRU in Cachelib at 16 threads. 
More details can be found in the paper. 



## Why don't adaptive algorithms work well?
There are several adaptive algorithms, e.g., ARC and TinyLFU, that also perform quick demotion and should work as least as good as S3-FIFO in theory. 
Where do they fall short? We take a closer look at demotion speed and precision to get a deeper understanding.
The *normalized quick demotion speed* measures how long objects stay in <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> before they are evicted or moved to <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>. 
{% katexmm %}
We use the LRU eviction age as a baseline and calculate the speed as $\frac{\text{LRU eviction age}}{\text{time in } \mathcal{S}}$. Here we use logical time measured in request count. 
The quick demotion precision measures how many objects evicted from <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> are not reused soon. Using an idea similar to previous work~\cite{song_learning_2020}, if the number of requests till an object's next reuse is larger than $\frac{\text{cache size}}{\text{miss ratio}}$, then we say the quick demotion results in a correct early eviction.
{% endkatexmm %}

An algorithm with both faster and more precise quick demotion exhibits a lower miss ratio. 


<center>
<figure style="width: 96%" class="align-center">
  <img src="/assets/posts/2023-08-16-s3fifo/twitter_demotion_0.1.svg" alt="Twitter large" style="width:40%">
  <img src="/assets/posts/2023-08-16-s3fifo/msr_demotion_0.1.svg" alt="MSR large" style="width:40%">
  <figcaption><h4>The normalized mean quick demotion speed and precision of different algorithms. TinyLFU and S3-FIFO use different small queue sizes (1%, 2%, 5%, 10%, 20%, 30%, and 40% of cache size) and have multiple points with lighter colors representing larger sizes. The marker of 10% small queue size is highlighted with a larger size. The left figure shows the Twitter workload, and the right figure shows the MSR workload. </h4></figcaption>
</figure> 
</center>

Miss ratios on the Twitter and MSR traces when using different <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> sizes. 
On the Twitter trace, ARC has a miss ratio 0.0483, LRU has miss ratio 0.0488. On the MSR trace, ARC has a miss ratio 0.2891, LRU miss ratio 0.3188. 

| Trace   | S size  |  0.01  |  0.02  |  0.05  |  0.10  |  0.20  |  0.30  |  0.40  |
|---------|---------|:------:|:------:|:------:|:------:|:------:|:------:|:------:|
| Twitter | TinyLFU | 0.0437 | 0.0437 | **0.0586** | **0.0530** | 0.0441 | 0.0445 | 0.0451 |
| Twitter | S3-FIFO | 0.0423 | 0.0422 | 0.0422 | 0.0424 | 0.0432 | 0.0442 | 0.0455 |
| MSR     | TinyLFU | 0.2895 | 0.2904 | 0.2893 | 0.2900 | 0.2936 | 0.2949 | 0.2990 |
| MSR     | S3-FIFO | 0.2889 | 0.2887 | 0.2884 | 0.2891 | 0.2896 | 0.2936 | 0.2989 |



The figure and table above show that ARC, TinyLFU, and S3-FIFO can quickly demote new objects and have lower miss ratios compared to LRU.

**ARC** uses an adaptive algorithm to decide the size of <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> (recency queue). We find that the algorithm can identify the correct direction to adjust the size, but the size it finds is often too large or too small. For example, ARC chooses a very small <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> on the Twitter trace, causing most new objects to be evicted too quickly with low precision. 
This happens because of two trace properties. First, objects in the Twitter trace often have many requests; Second, new objects are constantly generated. 
Therefore, objects evicted from <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> are requested very soon, causing <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> to shrink to a very small size (around 0.01% of cache size). 
Meanwhile, constantly generated new (and popular) objects in <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> face more competition and often have to suffer a miss before being inserted in <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>, which causes low precision and a high miss ratio (Table~\ref{table:missratio}). 
On the MSR trace, ARC has a reasonable speed with relatively high precision, which correlates with its low miss ratio. 

**TinyLFU** and S3-FIFO have a predictable quick demotion speed --- reducing the size of <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> always increases the demotion speed. 
When Using the same <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> size, TinyLFU demotes slightly faster than S3-FIFO because it uses LRU, which keeps some old but recently-accessed objects, squeezing the available space for newly-inserted objects. 


Besides, *S3-FIFO often shows higher precision than TinyLFU at a similar quick demotion speed*, which explains why S3-FIFO has a lower miss ratio. 
TinyLFU compares the eviction candidates from <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> and <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>, then evicts the less-frequently-used candidate. When the eviction candidate from <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span> has a high frequency, it causes many worth-to-keep objects from <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> to be evicted. 
This causes not only a low precision but also unpredictable precision and miss ratio cliffs. 
For example, the precision shows a large dip at 5% and 10% <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> size, corresponding to a sudden increase in the miss ratio (in the table). 

Although S3-FIFO does not use advanced techniques, it achieves a robust and predictable quick demotion speed and precision. 
As <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> size increases, the speed decreases monotonically (moving towards the left in the figure), and the precision also increases until it reaches a peak. 
When <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> is very small, popular objects do not have enough time to accumulate a hit before being evicted, so the precision is low. Increasing <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> size leads to higher precision. When <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> is very large, many unpopular objects are requested in <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> and moved to <span style="font-family:Fantasy; font-variant-cap:small-caps">M</span>, leading to reduced precision as well. 
The miss ratio presented in the table shows that at similar quick demotion speed, higher precision always leads to lower miss ratios.  



### Can we tune the adaptive algorithms to work better?
We have also experimented with using an adaptive algorithm to change the size of FIFO queues in S3-FIFO. The results show that using an adaptive algorithm can improve the tail performance, but degrade overall performance. 
We find that tuning the adaptive algorithm is very challenging. 

In fact, adaptive algorithms all have many parameters. 
For example, queue resizing requires several parameters, e.g., the frequency of resizing, the amount of space moved each time, the lower bound of queue sizes, and the threshold for trigger resizing. 

Besides the many hard-to-tune parameters, adaptive algorithms adapt based on observation of the past. However, the past may not predict the future. We find that small perturbations in the workload often cause the adaptive algorithm to overreact. 
It is unclear how to balance between under-reaction and overreaction without introducing more parameters. 
Moreover, some adaptive algorithms implicitly assume that the miss ratio curve is convex because following the gradient direction leads to the global optimum. However, the miss ratio curves of scan-heavy workloads are often not convex. 


Although we have shown that S3-FIFO is not sensitive to <span style="font-family:Fantasy; font-variant-cap:small-caps">S</span> size, and the queue size is easier to choose than tuning an adaptive algorithm. We believe adaptations are still important, but how to adapt remains to be explored. 
For systems that need to find the best parameter, downsized simulations using spatial sampling can be used.


## Conclusion
We demonstrate that a cache often experiences a higher one-hit-wonder ratio than common full trace analysis. 
Our study on 6594 traces reveals that quickly removing one-hit wonders (quick demotion) is the secret weapon of many advanced algorithms. 
Motivated by this, we design S3-FIFO, a **S**imple and **S**calable cache eviction algorithm composed of only **S**tatic FIFO queues. 
Our evaluation shows that S3-FIFO achieves better and more robust efficiency than state-of-the-art algorithms. Meanwhile, it is more scalable than LRU-based algorithms. 


[^1]: We have also experienced with 1-bit counter, which shows slightly worse efficiency; however, we choose to use 2-bit because it is more robust and filters out more objects.  




## Acknowledgement
There are many people I would like to thank, including but not limited to my co-authors, Carnegie Mellon University Parallel Data Lab (and our sponsors), and Cloudlab. 
I would also like to give a big shoutout to the people and organizations that open-sourced and shared the traces. 

### Dataset information
* [Twitter](https://github.com/twitter/cache-traces)
* [Tencent Block](http://iotta.snia.org/traces/parallel?only=27917)
* [Tencent Photo](http://iotta.snia.org/traces/parallel?only=27476)
* [Wikimedia CDN](https://wikitech.wikimedia.org/wiki/Analytics/Data_Lake/Traffic/Caching)
* [Alibaba Block](https://github.com/alibaba/block-traces)
* [MSR](http://iotta.snia.org/traces/block-io?only=388)
* [FIU](http://iotta.snia.org/traces/block-io?only=390)
* [CloudPhysics](https://www.usenix.org/conference/fast15/technical-sessions/presentation/waldspurger)
* [Meta](https://cachelib.org/docs/Cache_Library_User_Guides/Cachebench_FB_HW_eval/)


This work is published at SOSP'23, more details can be found [here](https://jasony.me/publication/sosp23-s3fifo.pdf), and the slides can be found [here](https://jasony.me/slides/hotos23-qdlp.pdf). 
