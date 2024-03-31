
function scrollToLearnMoreSection() {
  const usageSection = document.getElementById('usage');
  usageSection.scrollIntoView({ behavior: 'smooth' });
}

// function getFontSize() {
//   const width = window.innerWidth;
//   if (width < 600) {
//     return 10; // Small screen font size
//   } else if (width < 1000) {
//     return 16; // Medium screen font size
//   } else {
//     return 20; // Large screen font size
//   }
// }


// barchar (performance-chart)
// Data
const dataChartBarDoubleDatasetsExample = {
  labels: ['Meta', 'Twitter', 'Wikimedia', 'Tencent', 'CDN'],
  datasets: [
    {
      label: 'FIFO',
      data: [0.0938, 0.0574, 0.1087, 0.0967, 0.0767],
      backgroundColor: '#889ABD',
      borderColor: '#889ABD',
    },
    {
      label: 'LRU',
      data: [0.0812, 0.0488, 0.0803, 0.0659, 0.0688],
      backgroundColor: '#778fc7',
      borderColor: '#778fc7',
    },
    {
      label: 'TinyLFU',
      data: [0.0853, 0.0445, 0.0605, 0.0715, 0.0656],
      backgroundColor: '#4F628E',
      borderColor: '#4F628E',
    },
    {
      label: 'S3-FIFO',
      data: [0.0755, 0.0424, 0.0629, 0.0551, 0.0622],
      backgroundColor: '#FFA630',
      borderColor: '#FFA630',
    },
  ]
};


const optionsChartBarDoubleDatasetsExample = {
  scales: {
    y: {
      stacked: false,
      ticks: {
        beginAtZero: true,
        font: {
          size: 20,
        },
      },
      title: {
        display: true,
        text: 'Mean Miss Ratio',
        font: {
          size: 28,
        }
      },
      // type: 'logarithmic',
    },
    x: {
      stacked: false,
      ticks: {
        font: {
          size: 24,
        },
        align: 'left',
      }
    },
  },
  plugins: {
    legend: {
      align: 'end',
      labels: {
        font: {
          size: 20, // Set the font size of the legend here
        },
        // color: '#e6e5e3'
      },

    },
  },
};


var myChart = new Chart(
  document.getElementById('bar-chart'), {
  type: 'bar',
  data: dataChartBarDoubleDatasetsExample,
  options: optionsChartBarDoubleDatasetsExample
});


// throughput-chart
const dataLine = {
  labels: ['1', '2', '4', '8', '16'],
  datasets: [
    {
      label: 'LRU',
      data: [2, 3, 4, 5, 6],
      borderColor: '#4F628E',
      backgroundColor: '#4F628E',
    },
    {
      label: 'S3-FIFO',
      data: [2, 7, 12, 18, 28],
      borderColor: '#FFA630',
      backgroundColor: '#FFA630',
    },
  ],
};

const optionsThroughput = {
  scales: {
    x: {
      title: {
        display: true,
        text: 'Number of threads',
        font: {
          size: 20,
        },
        color: '#e6e5e3'
      },
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3'
      },
      // type: 'logarithmic',
    },
    y: {
      title: {
        display: true,
        text: 'Throughput (MOPS/s)',
        font: {
          size: 20,
        },
        color: '#e6e5e3'
      },
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3'
      },
    },
  },

  plugins: {
    legend: {
      labels: {
        font: {
          size: 20, // Set the font size of the legend here
        },
        color: '#e6e5e3'
      },
    },
  },
};

const chart2 = new Chart(
  document.getElementById('throughput-chart'), {
  type: 'line',
  data: dataLine,
  options: optionsThroughput
}
);


// barchar (cachesize-chart)
const dataCachesizeBarChart = {
  labels: ['Meta', 'Twitter', 'Wikimedia ', 'Alibaba', 'Tencent', 'CDN1', 'CDN2'],
  datasets: [
    {
      label: 'LRU',
      data: [1, 1, 1, 1, 1, 1, 1],
      backgroundColor: '#4F628E',
      borderColor: '#4F628E',
    },
    {
      label: 'S3-FIFO',
      data: [0.78, 0.64, 0.71, 0.81, 0.84, 0.72, 0.54],
      backgroundColor: '#FFA630',
      borderColor: '#FFA630',
    },
  ],
};


const optionsdataCachesizeBarChart = {
  scales: {
    y:
    {
      stacked: false,
      ticks: {
        beginAtZero: true,
      },
      title: {
        display: true,
        // text: [['Cache Size'], ['to achieve around 10% miss ratio)']],
        // text: ['Cache Size', 'to achieve around 10% miss ratio'],
        text: "Cache Size",
        color: '#e6e5e3',
        font: {
          size: 20,

        }
      },
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3',
      }
    },
    x:
    {
      stacked: false,
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3',
      }
    },
  },
  plugins: {
    legend: {
      labels: {
        font: {
          size: 20, // Set the font size of the legend here
        },
        color: '#e6e5e3'
      },
    },
  },
};

const chart3 = new Chart(
  document.getElementById('cachesize-bar-chart'), {
  type: 'bar',
  data: dataCachesizeBarChart,
  options: optionsdataCachesizeBarChart
}
);

// barchar (cachesize-chart)
const dataOnehitwonderBarChart = {
  labels: ['0.01', '0.1', '0.5', '0.8'],
  datasets: [
    {
      label: 'Zipf',
      data: [0.88, 0.80, 0.52, 0.255],
      backgroundColor: '#4F628E',
      borderColor: '#4F628E',
    },
    {
      label: 'MSR',
      data: [0.88, 0.8, 0.52, 0.265],
      backgroundColor: '#507D1D',
      borderColor: '#507D1D',
    },
    {
      label: 'Twitter',
      data: [0.375, 0.26, 0.19, 0.12],
      backgroundColor: '#FFA630',
      borderColor: '#FFA630',
    },
  ],
};


const optionsdataOnehitwonderBarChart = {
  scales: {
    y:
    {
      stacked: false,
      ticks: {
        beginAtZero: true,
      },
      title: {
        display: true,
        text: 'fraction of evicted objects with no reuse',
        font: {
          size: 22,
        },
        color: '#e6e5e3',
      },
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3',
      }
    },
    x:
    {
      stacked: false,
      title: {
        display: true,
        text: 'Cache size (fraction of objects in the trace)',
        font: {
          size: 28,
        },
        color: '#e6e5e3',
      },
      ticks: {
        font: {
          size: 20,
        },
        color: '#e6e5e3',
      }
    },
  },
  plugins: {
    legend: {
      labels: {
        font: {
          size: 24, // Set the font size of the legend here
        },
        color: '#e6e5e3'
      },
    },
  },
};

const chart4 = new Chart(
  document.getElementById('onehitwonder-bar-chart'), {
  type: 'bar',
  data: dataOnehitwonderBarChart,
  options: optionsdataOnehitwonderBarChart
}
);


