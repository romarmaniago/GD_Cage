let winlossChart;

(function (jQuery) {
  "use strict";
  if (document.querySelectorAll('#myChart').length) {
    const chartElem = document.getElementById('myChart');
    const totalRollingVal = parseFloat(chartElem.dataset.totalrolling);
    const houseRollingVal = parseFloat(chartElem.dataset.houserolling);
    const totalRollingLabel = chartElem.dataset.totalRollingLabel || 'Total Rolling';
    const houseRollingLabel = chartElem.dataset.houseRollingLabel || 'House Rolling';
  
    const options = {
      series: [{
        name: 'Amount',
        data: [totalRollingVal, houseRollingVal]
      }],
      chart: {
        type: 'bar',
        height: 300,
        toolbar: {
          show: true,
          tools: {
            download: true
          }
        },
        animations: {
          enabled: true // We handle animation via CSS for slide-in effect
        }
      },
      plotOptions: {
        bar: {
          horizontal: true,
          distributed: true,
          borderRadius: 1,
          barHeight: '70%',
          dataLabels: {
            position: 'center'
          }
        }
      },
      xaxis: {
        categories: [totalRollingLabel, houseRollingLabel],
        labels: {
          show: true,
          style: {
            fontSize: '11px',
            colors: ['#6c757d']
          }
        }
      },
      yaxis: {
        labels: { show: false }
      },
      dataLabels: {
        enabled: true,
        formatter: function (val, opts) {
          const label = opts.w.config.xaxis.categories[opts.dataPointIndex];
          return [
            label,
            '₱' + Number(val).toLocaleString('en-US')
          ];
        },
        style: {
          colors: ['#ffffff'],
          fontSize: '13px',
          fontWeight: '600'
        },
        textAnchor: 'middle',
        offsetY: -15
      },
      tooltip: {
        enabled: true,
        y: {
          formatter: function (val) {
            return '₱' + Number(val).toLocaleString('en-US');
          }
        }
      },
      legend: { show: false },
      colors: [
        'var(--bs-primary)',        // Total Rolling
        'var(--bs-secondary)'       // House Rolling
      ]
    };
  
    if (typeof ApexCharts !== 'undefined') {
      const chart = new ApexCharts(chartElem, options);
      chart.render();
    }
  }
  
  
if (document.querySelectorAll('#d-activity').length) {
  const options = {
    series: [{
      name: 'Net',
      data: []
    }],
    chart: {
      type: 'bar',
      height: 230,
      toolbar: { show: false }
    },
    plotOptions: {
      bar: {
        distributed: true,
        horizontal: false,
        columnWidth: '40%',
        endingShape: 'rounded',
        borderRadius: 4
      }
    },
    fill: {
      opacity: 1,
      colors: []
    },
    dataLabels: {
      enabled: false
    },
    legend: {
      show: false
    },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent']
    },
    xaxis: {
      categories: [],
      labels: {
        style: { colors: getComputedStyle(document.documentElement).getPropertyValue('--bs-secondary-color').trim() }
      }
    },
    yaxis: {
      labels: {
        style: { colors: getComputedStyle(document.documentElement).getPropertyValue('--bs-secondary-color').trim() }
      }
    },
    tooltip: {
      y: {
        formatter: function (_, { dataPointIndex }) {
          const realVal = winlossChart.realNetData?.[dataPointIndex] || 0;
          const label = realVal >= 0 ? 'Win' : 'Loss';
          return `${label}: ₱ ${Math.abs(realVal).toLocaleString('en-US')}`;
        }
      }
    }
  };

  winlossChart = new ApexCharts(document.querySelector("#d-activity"), options);
  winlossChart.render();

  // ✅ Add this function here
  function updateWinlossChart(chartData) {
    if (!winlossChart) return;
  
    try {
      // Ipakita muna sa console ang raw data
      // console.log('Raw chartData.data:', chartData.data);
    
      // Gawin mong numeric
      const realData = chartData.data.map(v => parseFloat(v));
    
      // Log mo rin para makita kung negative nga ba
      // console.log('Parsed numeric realData:', realData);
    
      // Itabi sa chart object para sa tooltip
      winlossChart.realNetData = realData;
    
      // Height ng bar ay absolute value
      const displayData = realData.map(v => Math.abs(v));
    
      // Get Bootstrap CSS variables
      const style = getComputedStyle(document.documentElement);
      const primaryColor = style.getPropertyValue('--bs-primary').trim();
      const dangerColor = style.getPropertyValue('--bs-danger').trim();
      
      // Use Bootstrap colors for the bars
      const barColors = realData.map(v => v < 0 ? dangerColor : primaryColor);
    
      // Calculate trend (positive or negative)
      const totalWinloss = realData.reduce((sum, val) => sum + val, 0);
      const trend = totalWinloss >= 0 ? 'positive' : 'negative';
      
      // Update the chart with enhanced options
      winlossChart.updateOptions({
        series: [{
          name: 'Net',
          data: displayData
        }],
        xaxis: {
          categories: chartData.labels
        },
        fill: {
          colors: barColors
        },
       
        tooltip: {
          y: {
            formatter: function (_, { dataPointIndex }) {
              const realVal = realData[dataPointIndex] || 0;
              const label = realVal >= 0 ? 'Win' : 'Loss';
              return `${label}: ₱ ${Math.abs(realVal).toLocaleString('en-US')}`;
            }
          },
          x: {
            formatter: function(val) {
              return val;
            }
          },
          custom: function({ series, seriesIndex, dataPointIndex, w }) {
            const realVal = realData[dataPointIndex] || 0;
            const label = realVal >= 0 ? 'Win' : 'Loss';
            const color = realVal >= 0 ? primaryColor : dangerColor;
            
            return `
              <div class="custom-tooltip" style="padding: 8px; background: #fff; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
                <div style="font-weight: bold; margin-bottom: 4px;">${w.globals.labels[dataPointIndex]}</div>
                <div style="color: ${color}; font-weight: bold;">
                  ${label}: ₱ ${Math.abs(realVal).toLocaleString('en-US')}
                </div>
              </div>
            `;
          }
        }
      });
      
      // Update the trend indicator in the UI if it exists
      const trendIndicator = document.getElementById('winloss-trend');
      if (trendIndicator) {
        trendIndicator.className = `trend-indicator ${trend}`;
        const positiveText = trendIndicator.dataset.positive || 'Positive';
        const negativeText = trendIndicator.dataset.negative || 'Negative';
        trendIndicator.innerHTML = trend === 'positive' ? 
          `<i class="fas fa-arrow-up"></i> ${positiveText}` : 
          `<i class="fas fa-arrow-down"></i> ${negativeText}`;
      }
    } catch (error) {
      console.error('Error updating win/loss chart:', error);
      // Show error message in the chart area
      const chartContainer = document.getElementById('d-activity');
      if (chartContainer) {
        chartContainer.innerHTML = `
          <div class="text-center p-4">
            <i class="fas fa-exclamation-triangle text-warning mb-2" style="font-size: 24px;"></i>
            <p class="text-muted">Unable to display chart data</p>
          </div>
        `;
      }
    }
  }
  
  

  // ⬇️ Optional: expose globally if needed elsewhere
  window.updateWinlossChart = updateWinlossChart;
}

if (document.querySelectorAll('#d-main').length) {
  const options = {
      series: [{
          name: 'total',
          data: [94, 80, 94, 80, 94, 80, 94]
      }, {
          name: 'pipline',
          data: [72, 60, 84, 60, 74, 60, 78]
      }],
      chart: {
          fontFamily: '"Inter", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
          height: 245,
          type: 'area',
          toolbar: {
              show: false
          },
          sparkline: {
              enabled: false,
          },
      },
      colors: ["#3a57e8", "#4bc7d2"],
      dataLabels: {
          enabled: false
      },
      stroke: {
          curve: 'smooth',
          width: 3,
      },
      yaxis: {
        show: true,
        labels: {
          show: true,
          minWidth: 19,
          maxWidth: 19,
          style: {
            colors: "#8A92A6",
          },
          offsetX: -5,
        },
      },
      legend: {
          show: false,
      },
      xaxis: {
          labels: {
              minHeight:22,
              maxHeight:22,
              show: true,
              style: {
                colors: "#8A92A6",
              },
          },
          lines: {
              show: false  //or just here to disable only x axis grids
          },
          categories: ["Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug"]
      },
      grid: {
          show: false,
      },
      fill: {
          type: 'gradient',
          gradient: {
              shade: 'dark',
              type: "vertical",
              shadeIntensity: 0,
              gradientToColors: undefined, // optional, if not defined - uses the shades of same color in series
              inverseColors: true,
              opacityFrom: .4,
              opacityTo: .1,
              stops: [0, 50, 80],
              colors: ["#3a57e8", "#4bc7d2"]
          }
      },
      tooltip: {
        enabled: true,
      },
  };

  const chart = new ApexCharts(document.querySelector("#d-main"), options);
  chart.render();
  document.addEventListener('ColorChange', (e) => {
    console.log(e)
    const newOpt = {
      colors: [e.detail.detail1, e.detail.detail2],
      fill: {
        type: 'gradient',
        gradient: {
            shade: 'dark',
            type: "vertical",
            shadeIntensity: 0,
            gradientToColors: [e.detail.detail1, e.detail.detail2], // optional, if not defined - uses the shades of same color in series
            inverseColors: true,
            opacityFrom: .4,
            opacityTo: .1,
            stops: [0, 50, 60],
            colors: [e.detail.detail1, e.detail.detail2],
        }
    },
   }
    chart.updateOptions(newOpt)
  })
}
if ($('.d-slider1').length > 0) {
    const options = {
        centeredSlides: false,
        loop: false,
        slidesPerView: 4,
        autoplay:false,
        spaceBetween: 32,
        breakpoints: {
            320: { slidesPerView: 1 },
            550: { slidesPerView: 2 },
            991: { slidesPerView: 3 },
            1400: { slidesPerView: 3 },
            1500: { slidesPerView: 4 },
            1920: { slidesPerView: 4 },
            2040: { slidesPerView: 4 },
            2440: { slidesPerView: 4 }
        },
        pagination: {
            el: '.swiper-pagination'
        },
        navigation: {
            nextEl: '.my-custom-next',
            prevEl: '.my-custom-prev'
        },  

        // And if we need scrollbar
        scrollbar: {
            el: '.swiper-scrollbar'  
        }
    } 
    let swiper = new Swiper('.d-slider1',options);

    document.addEventListener('ChangeMode', (e) => {
      if (e.detail.rtl === 'rtl' || e.detail.rtl === 'ltr') {
        swiper.destroy(true, true)
        setTimeout(() => {
            swiper = new Swiper('.d-slider1',options);
        }, 500);
      }
    })
}

})(jQuery)
