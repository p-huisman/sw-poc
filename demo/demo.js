(function () {
  // document.readyState === "complete"
  //   ? doFetch()
  //   : document.addEventListener("DOMContentLoaded", doFetch);
  document.getElementById("FetchButton").addEventListener("click", doFetch);
})();

function doFetch() {
  fetch("http://localhost:9001/api/data-sample-request").then((response) => {
    response.json().then((data) => {
      console.log(data);
    });
  });
}
